import logging
from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from fastapp.models.taskModel import TaskModel
from fastapp.models.activityModel import ActivityModel
from fastapp.models.approvalModel import ApprovalModel
from fastapp.models.instanceModel import InstanceModel
from fastapp.controllers.websocketController import broadcast_fleet_activity

from fastapp.models.runModel import RunModel
from fastapp.database import get_db

logger = logging.getLogger(__name__)

agentM2MRouter = APIRouter(tags=["Agent Machine-to-Machine API"])

class ActivityReportRequest(BaseModel):
    taskId: str = Field(..., description="The task the agent is currently working on")
    eventType: str = Field(..., description="'thought', 'tool_call', 'message', 'error'")
    content: Dict[str, Any] = Field(..., description="The payload of the activity")

class TaskStatusUpdateRequest(BaseModel):
    status: str = Field(..., description="e.g. 'done', 'blocked', 'failed'")
    runId: Optional[str] = Field(None, description="The ID of the run context")
    errorDetails: Optional[str] = Field(None, description="Error trace if failed")
    result: Optional[str] = Field(None, description="The output result or summary of the task")

class AgentCommentRequest(BaseModel):
    content: str = Field(..., description="The message content to append to the issue chat thread")

class ApprovalRequestPayload(BaseModel):
    taskId: str
    actionType: str
    payload: Dict[str, Any]
    reason: str

def verify_agent_token(x_agent_token: str = Header(..., alias="X-Agent-Token")):
    """
    Middleware to verify the calling agent.
    In a real system, you compare this token to the gateway_token stored in InstanceModel via CSFLE.
    For POC, we'll assume it's valid if we find an instance with this token.
    """
    from fastapp.database import get_db
    # NOTE: Since instances store encrypted tokens in CSFLE, this lookup requires care. 
    # For now, we will perform a basic check.
    instance = get_db()["instances"].find_one({"dashboardToken": x_agent_token})
    if not instance:
        raise HTTPException(status_code=401, detail="Invalid Agent Token")
    return instance

class CostReportRequest(BaseModel):
    costUsd: float = Field(..., description="Cost in USD of the LLM inference")
    inputTokens: int = Field(0, description="Input tokens used")
    outputTokens: int = Field(0, description="Output tokens generated")
    runId: Optional[str] = Field(None, description="The ID of the run context")


@agentM2MRouter.get("/org")
def get_org_chart(agent: dict = Depends(verify_agent_token)):
    """Agent calls this to see which active roles report to it."""
    fleet_id = agent["fleetId"]
    instance_id = str(agent["_id"])
    
    subordinates = list(InstanceModel._collection().find({
        "fleetId": fleet_id,
        "reportsTo": instance_id,
        "status": {"$in": ["provisioned", "running"]}
    }))
    
    if not subordinates:
        info = "No roles currently report to you or they are offline."
    else:
        roles_with_ips = [f"{sub.get('fleetRole', 'Unknown')} (IP: {sub.get('externalIp') or sub.get('ip', 'unknown')})" for sub in subordinates]
        info = f"[{', '.join(roles_with_ips)}]"
        
    return {"info": info}

@agentM2MRouter.post("/tasks/reset-stale")
def reset_stale_tasks(agent: dict = Depends(verify_agent_token)):
    """On agent startup, reset any in_progress tasks assigned to this agent back to todo so they get retried."""
    from fastapp.database import get_db
    from datetime import datetime, timezone
    instance_id = str(agent["_id"])
    result = get_db()["tasks"].update_many(
        {"assigneeId": instance_id, "status": "in_progress"},
        {"$set": {"status": "todo", "updatedAt": datetime.now(timezone.utc)}}
    )
    return {"reset": result.modified_count}

@agentM2MRouter.get("/tasks/{task_id}/status")
def get_task_status(task_id: str, agent: dict = Depends(verify_agent_token)):
    """Lightweight status check - lets the VM's own retry loop tell whether a bihand
    complete/report/delegate/block call actually landed, without relying on stdout text
    matching (the bihand CLI always echoes a success-looking line regardless of whether
    the underlying request actually succeeded)."""
    task = TaskModel._getById(task_id)
    if not task:
        return {"status": None}
    return {"status": task.get("status")}

@agentM2MRouter.get("/tasks/next")
def get_next_task(agent: dict = Depends(verify_agent_token)):
    """Agent calls this to atomically check out the next ticket in the queue"""
    fleet_id = agent["fleetId"]
    instance_id = str(agent["_id"])
    
    # Bihand Cost Control: Budget Check
    from fastapp.models.fleetModel import FleetModel
    fleet = FleetModel._getById(fleet_id)
    if fleet and fleet.get("apiBudget", 0) > 0:
        if fleet.get("apiSpend", 0) >= fleet.get("apiBudget", 0):
            # Budget exceeded, agent is paused. Do not assign task.
            return {"message": "API Budget Exceeded. Agents are paused.", "task": None}
    
    task = TaskModel._getNextForAgent(fleet_id, instance_id)
    if not task:
        return {"message": "No tasks available in backlog", "task": None}
        
    # Start a Run record tracking this execution attempt
    run = RunModel._start(fleet_id, instance_id, task["_id"])
    
    # Log the checkout
    ActivityModel._log(fleet_id, instance_id, task["_id"], "status_change", {"newStatus": "in_progress", "note": "Checked out by agent", "runId": run["_id"]})
    
    # Inject Fleet Mission and Company Name into the returned task so the agent knows the "why" and "who"
    task["companyName"] = fleet.get("name", "Autonomous Company")
    task["companyMission"] = fleet.get("mission", "Execute assigned tasks.")
    task["runId"] = run["_id"]
    
    # Inject Subordinate Info
    subordinates = list(InstanceModel._collection().find({
        "fleetId": fleet_id,
        "reportsTo": instance_id,
        "status": {"$in": ["provisioned", "running"]}
    }))
    if not subordinates:
        task["subordinatesInfo"] = "No roles currently report to you or they are offline."
    else:
        roles_with_ips = [f"{sub.get('fleetRole', 'Unknown')} (IP: {sub.get('externalIp') or sub.get('ip', 'unknown')})" for sub in subordinates]
        task["subordinatesInfo"] = f"[{', '.join(roles_with_ips)}]"

    # Inject Task Chat History into the payload
    from fastapp.models.commentModel import CommentModel
    comments = CommentModel._listByTask(task["_id"])
    task["comments"] = [{"role": c.get("authorRole", "Unknown"), "content": c.get("content", "")} for c in comments]

    # Inject recent interactive chat (the "Live Chat" panel) with this same agent, so a task
    # assigned right after a conversation carries that context in. Claude Code and Codex are the
    # only runtimes with a persisted interactive chat today (see ChatMessageModel).
    if (agent.get("agentType") or agent.get("iteration")) in ("claudecode", "codex"):
        from fastapp.models.chatMessageModel import ChatMessageModel
        task["interactiveChatHistory"] = ChatMessageModel._recentTextTranscript(instance_id, limit=40)
    else:
        task["interactiveChatHistory"] = None

    # Inject Delegated Subtask Results (Paperclip-style childIssueSummaries)
    # These are child tasks that have already completed, providing structured context
    # when the parent is re-woken after all subtasks finish.
    child_tasks = list(TaskModel._collection().find({
        "parentTaskId": str(task["_id"]),
    }))
    if child_tasks:
        task["delegatedSubtasks"] = [
            {
                "title": t.get("title", "Untitled"),
                "status": t.get("status", "unknown"),
                "result": t.get("result") or "No result provided"
            }
            for t in child_tasks
        ]
    else:
        task["delegatedSubtasks"] = []

    # Inject Completed Sibling Subtasks Results (for result transfer between sibling subtasks)
    if task.get("parentTaskId"):
        from bson import ObjectId
        from fastapp.database import get_db
        sibling_tasks = list(TaskModel._collection().find({
            "parentTaskId": task["parentTaskId"],
            "_id": {"$ne": task["_id"]},
            "status": "done"
        }))
        task["completedSiblingTasks"] = []
        for s in sibling_tasks:
            s_assignee_id = s.get("assigneeId")
            try:
                db_id = ObjectId(s_assignee_id) if isinstance(s_assignee_id, str) else s_assignee_id
            except Exception:
                db_id = s_assignee_id
                
            s_instance = get_db()["instances"].find_one({"_id": db_id}) if db_id else None
            s_role = s_instance.get("fleetRole", "Subordinate") if s_instance else "Subordinate"
            s_role_clean = s_role.replace(" ", "_")
            
            task["completedSiblingTasks"].append({
                "taskId": s["_id"],
                "title": s.get("title", "Untitled"),
                "result": s.get("result") or "No result provided",
                "deliverablesFolder": f"deliverables/from_{s_role_clean}"
            })
    else:
        task["completedSiblingTasks"] = []

    return {"task": task}

@agentM2MRouter.post("/tasks/{task_id}/comments")
def post_task_comment(task_id: str, req: AgentCommentRequest, agent: dict = Depends(verify_agent_token)):
    """Agent posts a reply back to the human/team in the issue chat thread"""
    from fastapp.models.commentModel import CommentModel
    
    fleet_id = agent["fleetId"]
    instance_id = str(agent["_id"])
    
    CommentModel._create(
        fleet_id=fleet_id,
        task_id=task_id,
        author_id=instance_id,
        author_role=agent.get("fleetRole", "Agent"),
        content=req.content
    )
        
    return {"success": True}

@agentM2MRouter.post("/activity")
def report_activity(req: ActivityReportRequest, agent: dict = Depends(verify_agent_token)):
    """Agent calls this to stream its thought process and tool execution to the audit log"""
    fleet_id = agent["fleetId"]
    instance_id = str(agent["_id"])
    
    doc = ActivityModel._log(
        fleet_id=fleet_id,
        instance_id=instance_id,
        task_id=req.taskId,
        event_type=req.eventType,
        content=req.content
    )
    
    # Broadcast to the React UI live
    broadcast_fleet_activity(fleet_id, {
        "type": "agent_activity",
        "data": {
            "instanceId": instance_id,
            "role": agent.get("fleetRole", "Worker"),
            "taskId": req.taskId,
            "eventType": req.eventType,
            "content": req.content,
            "timestamp": doc["timestamp"].isoformat()
        }
    })
    
    return {"success": True}

class DelegateTaskRequest(BaseModel):
    role: str = Field(..., description="The role of the subordinate agent to delegate to (e.g., 'CTO', 'Developer')")
    title: str = Field(..., description="Task title")
    description: str = Field(..., description="Detailed instructions")
    parentTaskId: Optional[str] = Field(None, description="The parent task ID this is a subtask of")
    blockedByTaskIds: Optional[List[str]] = Field(None, description="Task IDs this new task must wait on before it can be picked up")

class BlockTaskRequest(BaseModel):
    blockedByTaskId: str = Field(..., description="Task ID that this task is waiting on")

@agentM2MRouter.post("/tasks/delegate")
def delegate_task(req: DelegateTaskRequest, agent: dict = Depends(verify_agent_token)):
    """Agent delegates a sub-task to another agent in the org chart by role"""
    fleet_id = agent["fleetId"]
    
    # Find the target agent by role in this fleet
    target_instance = InstanceModel._collection().find_one({
        "fleetId": fleet_id,
        "fleetRole": req.role,
        "status": {"$in": ["provisioned", "running"]}
    })
    
    if not target_instance:
        # If specific role not found, create unassigned task or return error
        # Let's return error so the delegating agent knows it failed
        return {"success": False, "error": f"No active agent found with role '{req.role}'"}
        
    task = TaskModel._create(
        fleet_id=fleet_id,
        title=req.title,
        description=req.description,
        assignee_id=str(target_instance["_id"]),
        parent_task_id=req.parentTaskId,
        creator_id=str(agent["_id"]),
        blocked_by_ids=req.blockedByTaskIds or []
    )
    
    ActivityModel._log(
        fleet_id=fleet_id,
        instance_id=str(agent["_id"]),
        task_id=req.parentTaskId or task["_id"],
        event_type="tool_call",
        content={"tool": "delegate", "args": {"role": req.role, "title": req.title}, "result": "Delegated successfully"}
    )

    # Block the parent task while waiting for the subtask(s)
    if req.parentTaskId:
        from fastapp.models.commentModel import CommentModel
        # Count ALL pending (non-terminal) subtasks for this parent, including the new one
        pending_count = TaskModel._collection().count_documents({
            "parentTaskId": req.parentTaskId,
            "status": {"$nin": ["done", "cancelled", "failed"]}
        })
        if pending_count == 1:
            result_msg = f"Waiting for delegated subtask: {req.title}"
        else:
            result_msg = f"Waiting for delegated subtask(s): {pending_count} pending"
        TaskModel._updateStatus(req.parentTaskId, "blocked", result_msg)
        CommentModel._create(
            fleet_id=fleet_id,
            task_id=req.parentTaskId,
            author_id="system",
            author_role="System",
            content=f"⏳ **Delegated subtask #{pending_count}**\n\nA subtask has been delegated to **{req.role}**:\n- **Title:** {req.title}\n- **Task ID:** {task['_id']}\n\nThis task will automatically resume when all {pending_count} subtask(s) are complete."
        )

    return {"success": True, "taskId": task["_id"], "message": f"Delegated to {req.role}"}

@agentM2MRouter.post("/tasks/{task_id}/block")
def block_task(task_id: str, req: BlockTaskRequest, agent: dict = Depends(verify_agent_token)):
    """Mark a task as blocked by another task. When the blocker completes, this task is automatically re-queued."""
    from fastapp.database import get_db
    from datetime import datetime, timezone
    fleet_id = agent["fleetId"]

    task = TaskModel._getById(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task["fleetId"] != fleet_id:
        raise HTTPException(status_code=403, detail="Task not in your fleet")

    blocker = TaskModel._getById(req.blockedByTaskId)
    if not blocker:
        raise HTTPException(status_code=404, detail="Blocker task not found")
    if blocker["fleetId"] != fleet_id:
        raise HTTPException(status_code=403, detail="Blocker task not in your fleet")

    # If blocker is already terminal, inject its result immediately — no need to block
    if blocker.get("status") in ("done", "cancelled"):
        from fastapp.models.commentModel import CommentModel
        CommentModel._create(
            fleet_id=fleet_id,
            task_id=task_id,
            author_id="system",
            author_role="System",
            content=(
                f"ℹ️ **Blocker already resolved** — task was already done when block was declared.\n\n"
                f"**Resolved blocker:** {blocker.get('title', req.blockedByTaskId)}\n"
                f"**Result:** {blocker.get('result') or 'No result'}"
            )
        )
        return {"success": True, "note": "Blocker already resolved, no block added"}

    get_db()["tasks"].update_one(
        {"_id": task_id},
        {"$addToSet": {"blockedByIds": req.blockedByTaskId}, "$set": {"updatedAt": datetime.now(timezone.utc)}}
    )
    ActivityModel._log(fleet_id, str(agent["_id"]), task_id, "status_change",
        {"note": f"Blocked by task '{blocker.get('title', req.blockedByTaskId)}' ({req.blockedByTaskId})"})
    return {"success": True}

@agentM2MRouter.patch("/tasks/{task_id}/status")
def update_task_status(task_id: str, req: TaskStatusUpdateRequest, agent: dict = Depends(verify_agent_token)):
    """Agent calls this to mark a task as done or blocked"""
    fleet_id = agent["fleetId"]
    instance_id = str(agent["_id"])
    
    task = TaskModel._getById(task_id)
    if not task:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Task not found")

    is_assignee = (task.get("assigneeId") == instance_id)
    is_creator = (task.get("creatorId") == instance_id)

    if not is_assignee and not is_creator:
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail="You can only update your own tasks or subtasks you delegated.")

    # Guard: If the task has already been cancelled, do not allow agents to resurrect or modify its status
    if task.get("status") == "cancelled":
        from fastapi import HTTPException
        raise HTTPException(
            status_code=400,
            detail="This task has been cancelled by the user. Submissions are no longer accepted."
        )

    # Guard: Cannot set parent task to done/in_review while subtasks are still processing or pending
    if req.status in ("done", "in_review"):
        active_subtasks = list(TaskModel._collection().find({
            "parentTaskId": task_id,
            "status": {"$nin": ["done", "cancelled", "failed"]}
        }))
        if active_subtasks:
            from fastapi import HTTPException
            raise HTTPException(
                status_code=400,
                detail=f"Cannot change task status to {req.status} while {len(active_subtasks)} delegated subtask(s) are still active/pending."
            )

    if req.status == "done":
        if not is_creator and not is_assignee:
            from fastapi import HTTPException
            raise HTTPException(status_code=403, detail="Only the author or assignee can mark this task as done.")

    if req.status == "todo" and task.get("status") == "in_review":
        if not is_creator:
            from fastapi import HTTPException
            raise HTTPException(status_code=403, detail="Only the author of this task can reject it. Please wait for the author to review your work.")

    if task and task.get("status") == "done" and task.get("result") and req.status == "done" and req.result:
        # Task already had a final result. Treat this new 'complete' as a chat comment instead.
        from fastapp.models.commentModel import CommentModel
        CommentModel._create(
            fleet_id=fleet_id,
            task_id=task_id,
            author_id=instance_id,
            author_role=agent.get("fleetRole", "Agent"),
            content=req.result
        )
        TaskModel._updateStatus(task_id, req.status, None) # Do not overwrite original result
        
        # Broadcast the comment activity
        broadcast_fleet_activity(fleet_id, {
            "type": "new_comment",
            "data": {
                "taskId": task_id,
                "authorId": instance_id,
                "authorRole": agent.get("fleetRole", "Agent"),
                "content": req.result,
                "timestamp": __import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat()
            }
        })
    else:
        TaskModel._updateStatus(task_id, req.status, req.result)

    # Evaluate dynamic transition triggers (peer blockers and parent fan-outs)
    TaskModel._evaluate_transitions(task_id, req.status, req.result, instance_id)

    run_id = req.runId
    if not run_id:
        active_run = get_db()["runs"].find_one({"taskId": task_id, "status": "running"})
        if active_run:
            run_id = active_run["_id"]

    if run_id:
        RunModel._complete(run_id, success=(req.status in ("done", "in_review", "blocked")), error_details=req.errorDetails)
        
    doc = ActivityModel._log(
        fleet_id=fleet_id,
        instance_id=instance_id,
        task_id=task_id,
        event_type="status_change",
        content={"newStatus": req.status, "result": req.result}
    )
    
    # Broadcast to the React UI live
    broadcast_fleet_activity(fleet_id, {
        "type": "task_status_change",
        "data": {
            "taskId": task_id,
            "newStatus": req.status,
            "instanceId": instance_id,
            "timestamp": doc["timestamp"].isoformat()
        }
    })
    
    return {"success": True}

@agentM2MRouter.post("/approvals/request")
def request_human_approval(req: ApprovalRequestPayload, agent: dict = Depends(verify_agent_token)):
    """Agent hits a governance gate (e.g. merge code) and requests human review"""
    approval = ApprovalModel._request(
        fleet_id=agent["fleetId"],
        instance_id=str(agent["_id"]),
        task_id=req.taskId,
        action_type=req.actionType,
        payload=req.payload,
        reason=req.reason
    )
    TaskModel._updateStatus(req.taskId, "pending_approval")
    return {"message": "Approval requested", "approvalId": approval["_id"]}

@agentM2MRouter.post("/costs")
def report_cost(req: CostReportRequest, agent: dict = Depends(verify_agent_token)):
    """Agent calls this to report LLM token spend, updating the fleet's running cost"""
    from fastapp.models.fleetModel import FleetModel
    fleet_id = agent["fleetId"]
    FleetModel._collection().update_one({"_id": fleet_id}, {"$inc": {"apiSpend": req.costUsd}})
    
    if req.runId:
        RunModel._addTokens(req.runId, req.inputTokens, req.outputTokens, req.costUsd)
        
    return {"success": True}

class WatchdogRequest(BaseModel):
    errorDetails: Optional[str] = Field(None, description="Detailed error captured during the run")
    stdout: Optional[str] = Field(None, description="Captured stdout from the execution run")
    stderr: Optional[str] = Field(None, description="Captured stderr from the execution run")
    originalAnswer: Optional[str] = Field(None, description="The agent's own final response, extracted VM-side, when its own retry loop exhausted all attempts to get the agent to finalize via bihand complete/report/delegate")

@agentM2MRouter.post("/tasks/{task_id}/runs/{run_id}/watchdog")
def run_watchdog_evaluation(task_id: str, run_id: str, req: Optional[WatchdogRequest] = None, agent: dict = Depends(verify_agent_token)):
    """Paperclip-style Watchdog: records the final disposition of a run that ended without the
    agent calling complete/report/delegate/block. The VM's own wrapper script (heartbeat.py and
    equivalents) already gives the agent multiple chances to finalize via a real bihand command,
    nudging it with its own prior answer, before ever calling this endpoint - so by the time we
    get here the run has genuinely failed to reach a disposition, and we just record that."""
    from fastapp.database import get_db
    fleet_id = agent["fleetId"]
    instance_id = str(agent["_id"])

    task = TaskModel._getById(task_id)
    if not task:
        return {"error": "Task not found"}

    # Skip watchdog if task is already in a terminal or intentional non-active state.
    # "blocked" = intentionally waiting (e.g., delegated to a subtask) — not an error.
    # "done" / "cancelled" = already resolved in the same run (e.g., agent marked done then exited).
    if task.get("status") in ("blocked", "done", "cancelled", "in_review"):
        # Auto-complete the active run if it is still marked running
        active_run = get_db()["runs"].find_one({"taskId": task_id, "status": "running"})
        if active_run:
            RunModel._complete(active_run["_id"], success=(task.get("status") in ("done", "in_review", "blocked")))
        return {"status": "ok"}

    if task.get("status") == "in_progress":
        error_details = req.errorDetails if req and req.errorDetails else "Agent process terminated without reporting a final disposition."
        original_answer = req.originalAnswer if req else None

        # Prefer the agent's own recovered answer as the result; fall back to the raw error.
        detailed_result = original_answer if original_answer else error_details
        if req and (req.stdout or req.stderr):
            detailed_result += "\n\n### 📋 Captured Agent Console Output:\n"
            if req.stdout:
                stdout_tail = req.stdout[-1500:] if len(req.stdout) > 1500 else req.stdout
                detailed_result += f"[STDOUT]\n{stdout_tail}\n"
            if req.stderr:
                stderr_tail = req.stderr[-1000:] if len(req.stderr) > 1000 else req.stderr
                detailed_result += f"[STDERR]\n{stderr_tail}\n"

        TaskModel._updateStatus(task_id, "failed", detailed_result)
        TaskModel._evaluate_transitions(task_id, "failed", detailed_result, instance_id)

        # Save complete trace in RunModel
        run_error_msg = f"Missing disposition: {error_details}"
        if req and (req.stdout or req.stderr):
            run_error_msg += f"\n\n[STDOUT]\n{req.stdout or ''}\n\n[STDERR]\n{req.stderr or ''}"
        RunModel._complete(run_id, success=False, error_details=run_error_msg)

        # Post a comment with captured console output so the user has full visibility of agent results!
        comment_content = (
            f"⚠️ **Stale disposition warning**\n\n"
            f"The agent process exited without completing the task or reporting progress"
            + (", even after being nudged with its own prior response" if original_answer else "")
            + f". The task has been automatically marked as **failed**.\n\n"
            f"**Error details:** {error_details}\n\n"
            f"*NORMALIZED CAUSE: successful_run_missing_state*"
        )
        if original_answer:
            comment_content += f"\n\n**Agent's last response (used as the failure result):**\n> {original_answer}"
        if req and (req.stdout or req.stderr):
            comment_content += "\n\n### 📋 Captured Agent Console Output:\n```text\n"
            if req.stdout:
                # Truncate to avoid extremely large comments while preserving the most important bottom section
                stdout_tail = req.stdout[-2500:] if len(req.stdout) > 2500 else req.stdout
                comment_content += f"{stdout_tail}\n"
            if req.stderr:
                stderr_tail = req.stderr[-1000:] if len(req.stderr) > 1000 else req.stderr
                comment_content += f"[STDERR]\n{stderr_tail}\n"
            comment_content += "```"

        from fastapp.models.commentModel import CommentModel
        CommentModel._create(
            fleet_id=fleet_id,
            task_id=task_id,
            author_id="system",
            author_role="System",
            content=comment_content
        )

        # Log the activity
        ActivityModel._log(fleet_id, instance_id, task_id, "status_change", {"newStatus": "failed", "note": f"Watchdog: {error_details[:50]}"})
        return {"status": "failed_by_watchdog"}

    return {"status": "ok"}

class SocialPostRequest(BaseModel):
    platform: str = Field(..., description="e.g. 'facebook', 'instagram', 'x', 'reddit'")
    text: str = Field(..., description="The status message content to post")
    imageUrl: Optional[str] = Field(None, description="Optional image URL for media-supporting platforms")
    videoUrl: Optional[str] = Field(None, description="Optional video clip URL")
    mediaUrls: Optional[List[str]] = Field(None, description="Optional list of multiple media URLs (images/videos)")

@agentM2MRouter.post("/social/post")
def post_to_social_endpoint(req: SocialPostRequest, agent: dict = Depends(verify_agent_token)):
    from fastapp.models.credentialModel import CredentialModel
    from fastapp.database import get_db
    import json
    from fastapp.utils.socialUtils import post_to_social
    
    platform_lower = req.platform.lower()
    
    # Try platform-specific social credentials dictionary first, then fallback to general socialCredentialId
    social_cred_id = (agent.get("socialCredentials") or {}).get(platform_lower)
    if not social_cred_id:
        social_cred_id = agent.get("socialCredentialId")
        
    if not social_cred_id:
        raise HTTPException(status_code=400, detail=f"No social media credential bound to agent {agent.get('_id')} for platform '{platform_lower}'")
        
    creds_doc = CredentialModel.get_by_id(social_cred_id)
    if not creds_doc:
        raise HTTPException(status_code=400, detail=f"Bound social media credential {social_cred_id} not found")
        
    try:
        decrypted_data = creds_doc.get("decrypted_data") or CredentialModel.decrypt_data(creds_doc["data"])
        creds_json = json.loads(decrypted_data)
        
        if isinstance(creds_json, dict) and platform_lower in creds_json:
            target_creds = creds_json[platform_lower]
        else:
            target_creds = creds_json
            
        res = post_to_social(
            platform=req.platform,
            creds=target_creds,
            text=req.text,
            image_url=req.imageUrl,
            video_url=req.videoUrl,
            media_urls=req.mediaUrls
        )
        if not res.get("success"):
            raise HTTPException(status_code=500, detail=res.get("error", "Unknown error occurred during posting"))
            
        # Log the social media post activity to the fleet timeline!
        ActivityModel._log(
            fleet_id=agent["fleetId"],
            instance_id=str(agent["_id"]),
            task_id=None,
            event_type="social_post",
            content={"platform": req.platform, "text": req.text, "result": res.get("result")}
        )
        
        # Broadcast the feed activity to UI
        broadcast_fleet_activity(agent["fleetId"], {
            "type": "social_post_success",
            "data": {
                "platform": req.platform,
                "text": req.text,
                "instanceId": str(agent["_id"]),
                "timestamp": __import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat()
            }
        })
        
        return {"success": True, "details": res.get("result")}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Social posting failed: {str(e)}")


@agentM2MRouter.get("/google/token")
async def get_google_token_proxy(agent: dict = Depends(verify_agent_token)):
    """Backend-secure Google OAuth access token proxy for agent VMs."""
    from fastapp.database import get_db
    from fastapp.models.credentialModel import CredentialModel
    import json
    import httpx
    import os
    
    # Try toolConnections first
    tool_connections = agent.get("toolConnections", {}) or {}
    gw_conn = tool_connections.get("googleWorkspace", {}) if isinstance(tool_connections, dict) else {}
    cred_info = gw_conn.get("credential", {}) if isinstance(gw_conn, dict) else {}
    
    refresh_token = None
    workspace_email = None
    
    if isinstance(cred_info, dict) and cred_info.get("refreshToken"):
        refresh_token = cred_info.get("refreshToken")
        workspace_email = gw_conn.get("email")
    else:
        # Fallback to the general credentials collection
        db = get_db()
        cred = db["credentials"].find_one({
            "userId": agent["userId"],
            "type": "google_workspace",
            "status": "active"
        })
        if cred:
            try:
                decrypted_data = CredentialModel.decrypt_data(cred["data"])
                cred_json = json.loads(decrypted_data)
                refresh_token = cred_json.get("refreshToken", "")
                workspace_email = cred_json.get("email", "")
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"Failed to decrypt Google credential: {e}")

    if not refresh_token:
        raise HTTPException(status_code=400, detail="Google Workspace credentials are not configured or missing.")

    platform_client_id = os.environ.get("GOOGLE_CLIENT_ID", "")
    platform_client_secret = os.environ.get("GOOGLE_CLIENT_SECRET", "")
    
    if not platform_client_id or not platform_client_secret:
        raise HTTPException(status_code=500, detail="OAuth client configuration is missing on Bihand control plane.")

    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            resp = await client.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "client_id": platform_client_id,
                    "client_secret": platform_client_secret,
                    "refresh_token": refresh_token,
                    "grant_type": "refresh_token"
                }
            )
            if resp.status_code != 200:
                raise HTTPException(status_code=resp.status_code, detail=f"Google token refresh failed: {resp.text}")
                
            token_data = resp.json()
            return {
                "access_token": token_data.get("access_token"),
                "email": workspace_email,
                "expires_in": token_data.get("expires_in", 3600)
            }
        except Exception as e:
            if isinstance(e, HTTPException):
                raise e
            raise HTTPException(status_code=500, detail=f"Failed to reach Google token endpoint: {e}")


# --- Personal-account channel sync (channel_sync.py on the VM) ---
# This is NOT the LLM agent - it's the thin, non-agentic Playwright/CDP script that scrapes
# a personal Messenger/Zalo inbox (no API/webhook exists for those) and executes pre-decided
# sends. It never decides what to send; it only reports and executes.

class PersonalChannelInboundRequest(BaseModel):
    platform: str = Field(..., description="'messenger' or 'zalo'")
    externalThreadId: str = Field(..., description="Stable per-customer thread identifier scraped from the inbox UI")
    externalCustomerId: str = Field(..., description="Customer identifier scraped from the thread (name/handle - platform exposes no stable ID for personal accounts)")
    externalMessageId: str = Field(..., description="Synthesized stable ID for this message (see MessageModel._syntheticExternalId)")
    text: str = Field(..., description="Scraped message text")


@agentM2MRouter.post("/channels/personal/inbound")
def report_personal_channel_inbound(req: PersonalChannelInboundRequest, agent: dict = Depends(verify_agent_token)):
    """channel_sync.py calls this once per newly-detected message from its scrape diff.
    Feeds the exact same downstream pipeline (CustomerProfile/Conversation/Message + debounce
    dispatch) as the webhook tiers - only the ingestion transport differs. Resolves the owning
    Flow by (platform, personal_browser, assignedInstanceId=this agent) - a flow, not the raw
    instance, is what conversations attach to, so reassigning it later moves the conversation
    with it."""
    from fastapp.models.customerProfileModel import CustomerProfileModel
    from fastapp.models.conversationModel import ConversationModel
    from fastapp.models.messageModel import MessageModel
    from fastapp.models.flowModel import FlowModel

    fleet_id = agent["fleetId"]
    instance_id = str(agent["_id"])

    flow = FlowModel._collection().find_one({
        "fleetId": fleet_id,
        "platform": req.platform,
        "channelType": "personal_browser",
        "assignedInstanceId": instance_id,
        "status": "active",
    })
    if not flow:
        raise HTTPException(status_code=404, detail=f"No active personal {req.platform} flow assigned to this agent")

    policy = flow.get("supportPolicy") or {}

    profile = CustomerProfileModel._getOrCreate(fleet_id, req.platform, req.externalCustomerId)
    stages = flow.get("stages") or []
    conversation = ConversationModel._getOrCreateActive(
        fleet_id=fleet_id,
        flow_id=flow["_id"],
        customer_profile_id=profile["_id"],
        platform=req.platform,
        channel_type="personal_browser",
        external_thread_id=req.externalThreadId,
        # Personal-account conversations default to draft-only regardless of the fleet's
        # general mode setting - real ToS-ban risk plus DOM-scraping fragility, per the plan.
        default_mode="draft" if policy.get("mode") != "human_only" else "human_only",
        initial_stage_key=stages[0]["key"] if stages else None,
    )

    message = MessageModel._create(
        conversation_id=conversation["_id"],
        platform=req.platform,
        direction="inbound",
        content=req.text,
        external_message_id=req.externalMessageId,
        status="received",
    )
    if message is None:
        return {"status": "duplicate"}

    ConversationModel._touch(conversation["_id"])
    CustomerProfileModel._incrementCounters(profile["_id"])

    from fastapp.tasks import dispatch_conversation_reply_task
    dispatch_conversation_reply_task.apply_async(args=[conversation["_id"]], countdown=10)

    return {"status": "ok", "conversationId": conversation["_id"]}


@agentM2MRouter.get("/channels/personal/pending-sends")
def get_personal_channel_pending_sends(agent: dict = Depends(verify_agent_token)):
    """channel_sync.py polls this each cycle for drafts that have been approved (or auto-
    generated in auto mode) and are waiting to be typed and sent through the browser. The VM
    is a dumb effector here - the text and destination were already fully decided server-side.
    Filters by the conversation's Flow.assignedInstanceId (not a stale conversation-level
    instanceId) so a reassigned flow's pending sends immediately follow the new agent."""
    from fastapp.models.conversationModel import ConversationModel
    from fastapp.models.flowModel import FlowModel

    instance_id = str(agent["_id"])
    db = get_db()
    pending = list(db["messages"].find({
        "status": "pending_send",
        "direction": "outbound",
    }).limit(50))

    results = []
    for msg in pending:
        conversation = ConversationModel._getById(msg["conversationId"])
        if not conversation or conversation.get("channelType") != "personal_browser":
            continue
        flow = FlowModel._getById(conversation.get("flowId"))
        if not flow or flow.get("assignedInstanceId") != instance_id:
            continue
        results.append({
            "messageId": msg["_id"],
            "conversationId": conversation["_id"],
            "platform": conversation["platform"],
            "externalThreadId": conversation["externalThreadId"],
            "text": msg["content"],
        })

    return {"pendingSends": results}


class MarkPersonalSendSentRequest(BaseModel):
    success: bool = Field(..., description="Whether channel_sync.py actually managed to type and send the message")
    error: Optional[str] = Field(default=None, description="Failure detail if success is false")


@agentM2MRouter.post("/channels/personal/pending-sends/{message_id}/mark-sent")
def mark_personal_channel_send_result(message_id: str, req: MarkPersonalSendSentRequest, agent: dict = Depends(verify_agent_token)):
    from fastapp.models.messageModel import MessageModel

    message = MessageModel._getById(message_id)
    if not message:
        raise HTTPException(status_code=404, detail="Message not found")

    MessageModel._setStatus(message_id, "sent" if req.success else "failed")
    if not req.success and req.error:
        logger.warning(f"channel_sync.py reported send failure for message {message_id}: {req.error}")

    return {"status": "ok"}


# --- Agent-facing flow management ---
# A "flow" (channel connection + engagement policy) belongs to the fleet, not a single
# agent - agents are *assigned* to operate one, and that can change. Permission model
# mirrors the one precedent that already exists in this codebase (taskModel._getNextForAgent's
# root-vs-subordinate gate): root-level agents (reportsTo falsy) get fleet-wide authority to
# create flows by default; anyone else needs an explicit grant, requested via the existing
# Approval flow rather than a new mechanism.

class StageDefPayload(BaseModel):
    key: str = Field(..., description="Stable identifier, referenced by Conversation.currentStageKey")
    name: str
    goal: str = Field(default="", description="What the agent should accomplish in this stage")
    exitCriteria: str = Field(default="", description="What must be true before the model marks stage_complete")
    escalateToHuman: bool = Field(default=False, description="Completing this stage forces human review regardless of the flow's mode")
    maxTurns: Optional[int] = Field(default=None, description="Flag for human review if the conversation stays in this stage past this many turns")


def _validate_stages(stages: Optional[List[Dict[str, Any]]]) -> None:
    if not stages:
        return
    keys = [s.get("key") for s in stages]
    if any(not k for k in keys):
        raise HTTPException(status_code=400, detail="Every stage requires a non-empty key")
    if len(keys) != len(set(keys)):
        raise HTTPException(status_code=400, detail="Stage keys must be unique within a flow")


class FlowCreatePayload(BaseModel):
    name: str
    platform: str = Field(..., description="'messenger' or 'zalo'")
    channelType: str = Field(..., description="'page_webhook', 'oa_webhook', or 'personal_browser'")
    assignedInstanceId: Optional[str] = Field(default=None, description="Defaults to the creating agent")
    pageId: Optional[str] = None
    oaId: Optional[str] = None
    verifyToken: Optional[str] = None
    credentialId: Optional[str] = None
    label: Optional[str] = None
    stages: Optional[List[StageDefPayload]] = Field(default=None, description="Optional ordered funnel - omit for a flow that responds without stage tracking")


class FlowUpdatePayload(BaseModel):
    name: Optional[str] = None
    supportPolicy: Optional[Dict[str, Any]] = None
    assignedInstanceId: Optional[str] = None
    status: Optional[str] = None
    stages: Optional[List[StageDefPayload]] = Field(default=None, description="Replaces the entire funnel - omit to leave stages unchanged, pass [] to clear it")


class FlowAccessRequestPayload(BaseModel):
    requestedRole: str = Field(default="viewer", description="'viewer', 'editor', or 'owner'")
    reason: str = Field(..., description="Why this agent needs access - shown to the human approver")


def _is_root_agent(agent: dict) -> bool:
    return not agent.get("reportsTo")


@agentM2MRouter.get("/credentials", summary="List the fleet owner's credentials (name/type only, never secret data)")
def list_credentials_for_agent(type: Optional[str] = None, agent: dict = Depends(verify_agent_token)):
    """Lets a root agent discover which credential to bind to a flow it's about to create -
    e.g. resolving a human-given Page name like 'Scabo' to the matching social_facebook
    credential's id. Only id/name/type are ever returned - CredentialModel.list_by_user already
    masks the encrypted data field to '***', and this endpoint doesn't forward even that."""
    if not _is_root_agent(agent):
        raise HTTPException(status_code=403, detail="Only root-level agents can list credentials.")

    from fastapp.models.fleetModel import FleetModel
    from fastapp.models.credentialModel import CredentialModel

    fleet = FleetModel._getById(agent["fleetId"])
    creds = CredentialModel.list_by_user(user_id=fleet["userId"])
    if type:
        creds = [c for c in creds if c.get("type") == type]
    return {"credentials": [{"id": c["_id"], "name": c["name"], "type": c["type"]} for c in creds]}


@agentM2MRouter.post("/flows")
def create_flow(req: FlowCreatePayload, agent: dict = Depends(verify_agent_token)):
    """Lets an agent set up a customer-support flow itself - e.g. fulfilling a Task like
    'set up Messenger support for our Page' - without a human touching the dashboard.
    Gated to root-level agents by default, mirroring the existing root-vs-subordinate
    precedent in TaskModel._getNextForAgent rather than inventing a new permission tier."""
    if not _is_root_agent(agent):
        raise HTTPException(status_code=403, detail="Only root-level agents can create flows. Ask a root agent, or request access to an existing flow.")

    stages_dicts = [s.dict() for s in req.stages] if req.stages else None
    _validate_stages(stages_dicts)

    # An LLM agent has no reliable way to mint a secure verify token itself, and Meta's
    # webhook handshake requires an exact match - auto-generate one server-side whenever a
    # webhook-based flow is created without one, same token-generation pattern already used
    # for OAuth state in credentialController.py's start_google_workspace_oauth.
    verify_token = req.verifyToken
    if not verify_token and req.channelType in ("page_webhook", "oa_webhook"):
        import secrets
        verify_token = secrets.token_urlsafe(24)

    from fastapp.models.flowModel import FlowModel
    flow = FlowModel._create(
        fleet_id=agent["fleetId"],
        name=req.name,
        platform=req.platform,
        channel_type=req.channelType,
        created_by=f"instance:{agent['_id']}",
        assigned_instance_id=req.assignedInstanceId or str(agent["_id"]),
        page_id=req.pageId,
        oa_id=req.oaId,
        verify_token=verify_token,
        credential_id=req.credentialId,
        label=req.label,
        stages=stages_dicts,
    )

    # Same computation the Webhook Setup card uses client-side
    # (frontend/src/pages/fleet/FleetSupport.tsx: `${window.location.origin}/api/webhooks/${platform}`)
    # - one shared callback URL per platform for the whole deployment, since Meta/Zalo's payload
    # itself carries the page_id/oa_id the receiving handler discriminates by, not a URL segment.
    # Included here so the agent relays a real URL instead of guessing one.
    import os
    public_api_url = os.environ.get("BIHAND_PUBLIC_API_URL", "http://localhost:8501").rstrip("/")
    webhook_url = f"{public_api_url}/api/webhooks/{req.platform}"

    return {"flow": flow, "webhookUrl": webhook_url}


@agentM2MRouter.get("/flows")
def list_agent_flows(agent: dict = Depends(verify_agent_token)):
    """Flows this agent created, is assigned to operate, or has been granted access to."""
    from fastapp.models.flowModel import FlowModel
    flows = FlowModel._listAccessibleByInstance(agent["fleetId"], str(agent["_id"]))
    return {"flows": flows}


@agentM2MRouter.patch("/flows/{flow_id}")
def update_flow_m2m(flow_id: str, req: FlowUpdatePayload, agent: dict = Depends(verify_agent_token)):
    from fastapp.models.flowModel import FlowModel
    flow = FlowModel._getById(flow_id)
    if not flow or flow.get("fleetId") != agent["fleetId"]:
        raise HTTPException(status_code=404, detail="Flow not found")
    if not FlowModel._hasPermission(flow, str(agent["_id"]), "editor"):
        raise HTTPException(status_code=403, detail="You don't have edit access to this flow. Request access first.")

    updates = {k: v for k, v in req.dict(exclude_unset=True).items() if v is not None}
    if "stages" in updates:
        updates["stages"] = [s if isinstance(s, dict) else s.dict() for s in updates["stages"]]
        _validate_stages(updates["stages"])
    FlowModel._update(flow_id, updates)
    return {"flow": FlowModel._getById(flow_id)}


@agentM2MRouter.delete("/flows/{flow_id}")
def delete_flow_m2m(flow_id: str, agent: dict = Depends(verify_agent_token)):
    from fastapp.models.flowModel import FlowModel
    flow = FlowModel._getById(flow_id)
    if not flow or flow.get("fleetId") != agent["fleetId"]:
        raise HTTPException(status_code=404, detail="Flow not found")
    if not FlowModel._hasPermission(flow, str(agent["_id"]), "owner"):
        raise HTTPException(status_code=403, detail="Only the flow's owner can delete it.")

    FlowModel._delete(flow_id)
    return {"message": "Flow deleted"}


@agentM2MRouter.post("/flows/{flow_id}/request-access")
def request_flow_access(flow_id: str, req: FlowAccessRequestPayload, agent: dict = Depends(verify_agent_token)):
    """An agent without sufficient access asks a human to grant it - reuses the existing
    Approval flow (same pending/approved/rejected mechanics and the same ApprovalsInbox.tsx
    UI already used for shadow-mode draft replies), rather than a bespoke access-request
    system."""
    from fastapp.models.flowModel import FlowModel
    flow = FlowModel._getById(flow_id)
    if not flow or flow.get("fleetId") != agent["fleetId"]:
        raise HTTPException(status_code=404, detail="Flow not found")

    if req.requestedRole not in ("viewer", "editor", "owner"):
        raise HTTPException(status_code=400, detail="requestedRole must be 'viewer', 'editor', or 'owner'")

    approval = ApprovalModel._request(
        fleet_id=agent["fleetId"],
        instance_id=str(agent["_id"]),
        action_type="flow_access_request",
        payload={"flowId": flow_id, "requestedRole": req.requestedRole, "flowName": flow.get("name")},
        reason=req.reason,
    )
    return {"message": "Access request submitted for human review", "approvalId": approval["_id"]}


