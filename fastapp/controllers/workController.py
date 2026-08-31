from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from typing import List, Optional, Dict
from fastapp.controllers.authController import get_current_user
from fastapp.models.taskModel import TaskModel
from fastapp.models.activityModel import ActivityModel
from fastapp.models.approvalModel import ApprovalModel
from fastapp.models.fleetModel import FleetModel
from fastapp.models.goalModel import GoalModel
from fastapp.models.runModel import RunModel
from fastapp.models.routineModel import RoutineModel

workRouter = APIRouter(tags=["Work & Governance (Human UI)"])

class CreateTaskRequest(BaseModel):
    title: str = Field(..., description="Goal or Ticket title")
    description: str = Field(..., description="Detailed instructions for the agent")
    assigneeId: Optional[str] = Field(None, description="Specific Instance ID or None for any worker")
    parentTaskId: Optional[str] = Field(None, description="Parent goal if sub-tasking")
    goalId: Optional[str] = Field(None, description="Parent Company Goal")
    priority: str = Field(default="none", description="Priority level: none, low, medium, high, critical")
    status: str = Field(default="todo", description="Status: backlog, todo, in_progress, in_review, done, blocked, cancelled, failed")

class CreateGoalRequest(BaseModel):
    title: str = Field(..., description="Goal Title")
    description: str = Field(..., description="Goal Description")

class ResolveApprovalRequest(BaseModel):
    status: str = Field(..., description="'approved' or 'rejected'")

class CreateRoutineRequest(BaseModel):
    title: str = Field(..., description="Routine title")
    description: str = Field(..., description="Routine task instructions")
    cronExpr: str = Field(..., description="Cron schedule expression")
    assigneeId: Optional[str] = Field(None, description="Specific Instance ID or None")

@workRouter.get("/{fleet_id}/goals")
async def list_fleet_goals(fleet_id: str, auth_payload: dict = Depends(get_current_user)):
    """Get all high-level goals for a specific company fleet"""
    email = auth_payload["email"]
    user_role = auth_payload.get("role", "user")
    from fastapp.utils.adminAuth import ADMIN_EMAILS
    if auth_payload.get("email") in ADMIN_EMAILS:
        user_role = "admin"
    
    fleet = FleetModel._getById(fleet_id)
    if not fleet:
        raise HTTPException(status_code=404, detail="Fleet not found")
    if fleet["userId"] != email and user_role != "admin":
        raise HTTPException(status_code=404, detail="Fleet not found")
        
    goals = GoalModel._listByFleet(fleet_id)
    for g in goals:
        g["_id"] = str(g["_id"])
    return {"goals": goals}

@workRouter.post("/{fleet_id}/goals")
async def create_fleet_goal(fleet_id: str, req: CreateGoalRequest, auth_payload: dict = Depends(get_current_user)):
    """Human creates a new high-level goal for the fleet"""
    email = auth_payload["email"]
    user_role = auth_payload.get("role", "user")
    from fastapp.utils.adminAuth import ADMIN_EMAILS
    if auth_payload.get("email") in ADMIN_EMAILS:
        user_role = "admin"
    
    fleet = FleetModel._getById(fleet_id)
    if not fleet:
        raise HTTPException(status_code=404, detail="Fleet not found")
    if fleet["userId"] != email and user_role != "admin":
        raise HTTPException(status_code=404, detail="Fleet not found")
        
    goal = GoalModel._create(
        fleet_id=fleet_id,
        title=req.title,
        description=req.description
    )
    return {"message": "Goal created", "goal": goal}

@workRouter.get("/{fleet_id}/tasks")
async def list_fleet_tasks(fleet_id: str, auth_payload: dict = Depends(get_current_user)):
    """Get all tasks (Kanban board) for a specific company fleet"""
    email = auth_payload["email"]
    user_role = auth_payload.get("role", "user")
    from fastapp.utils.adminAuth import ADMIN_EMAILS
    if auth_payload.get("email") in ADMIN_EMAILS:
        user_role = "admin"
    
    fleet = FleetModel._getById(fleet_id)
    if not fleet:
        raise HTTPException(status_code=404, detail="Fleet not found")
    if fleet["userId"] != email and user_role != "admin":
        raise HTTPException(status_code=404, detail="Fleet not found")
        
    tasks = TaskModel._listByFleet(fleet_id)
    for t in tasks:
        t["_id"] = str(t["_id"])
    return {"tasks": tasks}

@workRouter.post("/{fleet_id}/tasks")
async def create_fleet_task(fleet_id: str, req: CreateTaskRequest, auth_payload: dict = Depends(get_current_user)):
    """Human creates a new goal/task for the fleet"""
    email = auth_payload["email"]
    user_role = auth_payload.get("role", "user")
    from fastapp.utils.adminAuth import ADMIN_EMAILS
    if auth_payload.get("email") in ADMIN_EMAILS:
        user_role = "admin"
    
    fleet = FleetModel._getById(fleet_id)
    if not fleet:
        raise HTTPException(status_code=404, detail="Fleet not found")
    if fleet["userId"] != email and user_role != "admin":
        raise HTTPException(status_code=404, detail="Fleet not found")
        
    task = TaskModel._create(
        fleet_id=fleet_id,
        title=req.title,
        description=req.description,
        assignee_id=req.assigneeId,
        parent_task_id=req.parentTaskId,
        goal_id=req.goalId,
        priority=req.priority,
        status=req.status
    )
    return {"message": "Task created", "task": task}

class ArchiveTasksRequest(BaseModel):
    taskIds: List[str] = Field(..., description="List of task IDs to archive")

@workRouter.post("/{fleet_id}/tasks/archive")
async def archive_tasks(fleet_id: str, req: ArchiveTasksRequest, auth_payload: dict = Depends(get_current_user)):
    email = auth_payload["email"]
    user_role = auth_payload.get("role", "user")
    from fastapp.utils.adminAuth import ADMIN_EMAILS
    if auth_payload.get("email") in ADMIN_EMAILS:
        user_role = "admin"
        
    fleet = FleetModel._getById(fleet_id)
    if not fleet or (fleet["userId"] != email and user_role != "admin"):
        raise HTTPException(status_code=404, detail="Fleet not found")
        
    from fastapp.database import get_db
    tasks = list(get_db()["tasks"].find({
        "_id": {"$in": req.taskIds},
        "fleetId": fleet_id
    }))
    
    unarchivable = []
    archivable_ids = []
    for t in tasks:
        if t.get("status") in ["in_progress", "blocked"]:
            unarchivable.append(t.get("identifier", str(t["_id"])))
        else:
            archivable_ids.append(t["_id"])
            
    if unarchivable:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot archive tasks that are active (in_progress) or blocked: {', '.join(unarchivable)}"
        )
        
    if archivable_ids:
        get_db()["tasks"].update_one(
            {"_id": {"$in": archivable_ids}},
            {"$set": {"archived": True}}
        )
        
    return {"success": True, "archivedCount": len(archivable_ids)}

@workRouter.get("/{fleet_id}/activity")
async def get_fleet_activity(fleet_id: str, limit: int = 100, auth_payload: dict = Depends(get_current_user)):
    """Get the immutable audit trail of what agents in the fleet are doing"""
    email = auth_payload["email"]
    user_role = auth_payload.get("role", "user")
    from fastapp.utils.adminAuth import ADMIN_EMAILS
    if auth_payload.get("email") in ADMIN_EMAILS:
        user_role = "admin"
    
    fleet = FleetModel._getById(fleet_id)
    if not fleet:
        raise HTTPException(status_code=404, detail="Fleet not found")
    if fleet["userId"] != email and user_role != "admin":
        raise HTTPException(status_code=404, detail="Fleet not found")
        
    activity = ActivityModel._listByFleet(fleet_id, limit)
    for a in activity:
        a["_id"] = str(a["_id"])
    return {"activity": activity}

@workRouter.get("/{fleet_id}/approvals/pending")
async def get_pending_approvals(fleet_id: str, auth_payload: dict = Depends(get_current_user)):
    """Get all governance gates currently blocking agents in the fleet"""
    email = auth_payload["email"]
    user_role = auth_payload.get("role", "user")
    from fastapp.utils.adminAuth import ADMIN_EMAILS
    if auth_payload.get("email") in ADMIN_EMAILS:
        user_role = "admin"
    
    fleet = FleetModel._getById(fleet_id)
    if not fleet:
        raise HTTPException(status_code=404, detail="Fleet not found")
    if fleet["userId"] != email and user_role != "admin":
        raise HTTPException(status_code=404, detail="Fleet not found")
        
    approvals = ApprovalModel._listPendingByFleet(fleet_id)
    for a in approvals:
        a["_id"] = str(a["_id"])
    return {"approvals": approvals}

@workRouter.post("/approvals/{approval_id}/resolve")
async def resolve_approval(approval_id: str, req: ResolveApprovalRequest, auth_payload: dict = Depends(get_current_user)):
    """Human reviews and approves/rejects an agent's proposed action"""
    if req.status not in ["approved", "rejected"]:
        raise HTTPException(status_code=400, detail="Invalid status")

    approval = ApprovalModel._getById(approval_id)
    if not approval:
        raise HTTPException(status_code=404, detail="Approval not found")

    email = auth_payload["email"]
    user_role = auth_payload.get("role", "user")
    from fastapp.utils.adminAuth import ADMIN_EMAILS
    if auth_payload.get("email") in ADMIN_EMAILS:
        user_role = "admin"

    fleet = FleetModel._getById(approval["fleetId"])
    if not fleet or (fleet["userId"] != email and user_role != "admin"):
        raise HTTPException(status_code=404, detail="Approval not found")

    ApprovalModel._resolve(approval_id, req.status, email)

    # Customer-support shadow-mode reply approvals actually dispatch (or discard) the drafted
    # message on resolve - unlike generic approvals, which just unblock a VM-side action the
    # agent performs on its own next poll.
    if approval.get("actionType") == "send_reply" and approval.get("conversationId"):
        message_id = (approval.get("payload") or {}).get("messageId")
        if req.status == "approved":
            from fastapp.tasks import send_approved_reply_task
            send_approved_reply_task.delay(approval["conversationId"], message_id)
        elif message_id:
            from fastapp.models.messageModel import MessageModel
            MessageModel._setStatus(message_id, "discarded")

    elif approval.get("actionType") == "flow_access_request" and req.status == "approved":
        # An agent asked for access to a fleet-owned flow it didn't create/wasn't assigned
        # (see agentM2MController.request_flow_access) - grant it the requested role now
        # that a human has reviewed the request via this same approvals endpoint.
        payload = approval.get("payload") or {}
        flow_id = payload.get("flowId")
        requested_role = payload.get("requestedRole", "viewer")
        if flow_id:
            from fastapp.models.flowModel import FlowModel
            FlowModel._grantAccess(flow_id, approval["instanceId"], requested_role)

    return {"message": f"Approval {req.status}"}

@workRouter.get("/{fleet_id}/conversations")
async def list_conversations(fleet_id: str, status: Optional[str] = None, auth_payload: dict = Depends(get_current_user)):
    """List customer-support conversation threads for a fleet (dashboard visibility for the
    shadow-mode pipeline - without this, drafted replies would just silently accumulate)."""
    email = auth_payload["email"]
    user_role = auth_payload.get("role", "user")
    from fastapp.utils.adminAuth import ADMIN_EMAILS
    if auth_payload.get("email") in ADMIN_EMAILS:
        user_role = "admin"

    fleet = FleetModel._getById(fleet_id)
    if not fleet or (fleet["userId"] != email and user_role != "admin"):
        raise HTTPException(status_code=404, detail="Fleet not found")

    from fastapp.models.conversationModel import ConversationModel
    conversations = ConversationModel._listByFleet(fleet_id, status=status)
    return {"conversations": conversations}

@workRouter.get("/{fleet_id}/conversations/{conversation_id}")
async def get_conversation_detail(fleet_id: str, conversation_id: str, auth_payload: dict = Depends(get_current_user)):
    """Full thread detail: the conversation, its customer profile, and message history."""
    email = auth_payload["email"]
    user_role = auth_payload.get("role", "user")
    from fastapp.utils.adminAuth import ADMIN_EMAILS
    if auth_payload.get("email") in ADMIN_EMAILS:
        user_role = "admin"

    fleet = FleetModel._getById(fleet_id)
    if not fleet or (fleet["userId"] != email and user_role != "admin"):
        raise HTTPException(status_code=404, detail="Fleet not found")

    from fastapp.models.conversationModel import ConversationModel
    from fastapp.models.customerProfileModel import CustomerProfileModel
    from fastapp.models.messageModel import MessageModel

    conversation = ConversationModel._getById(conversation_id)
    if not conversation or conversation.get("fleetId") != fleet_id:
        raise HTTPException(status_code=404, detail="Conversation not found")

    profile = CustomerProfileModel._getById(conversation.get("customerProfileId"))
    messages = MessageModel._recentByConversation(conversation_id, limit=200)

    return {"conversation": conversation, "customerProfile": profile, "messages": messages}

@workRouter.get("/{fleet_id}/instances/{instance_id}/runs")
async def list_agent_runs(fleet_id: str, instance_id: str, auth_payload: dict = Depends(get_current_user)):
    """Get all runs for a specific agent (for the Agent Detail Dashboard)"""
    email = auth_payload["email"]
    user_role = auth_payload.get("role", "user")
    from fastapp.utils.adminAuth import ADMIN_EMAILS
    if auth_payload.get("email") in ADMIN_EMAILS:
        user_role = "admin"
    fleet = FleetModel._getById(fleet_id)
    if not fleet or (fleet["userId"] != email and user_role != "admin"):
        raise HTTPException(status_code=404, detail="Fleet not found")
        
    runs = RunModel._listByInstance(instance_id)
    for r in runs:
        r["_id"] = str(r["_id"])
    return {"runs": runs}

@workRouter.get("/{fleet_id}/routines")
async def list_fleet_routines(fleet_id: str, auth_payload: dict = Depends(get_current_user)):
    email = auth_payload["email"]
    user_role = auth_payload.get("role", "user")
    from fastapp.utils.adminAuth import ADMIN_EMAILS
    if auth_payload.get("email") in ADMIN_EMAILS:
        user_role = "admin"
    
    fleet = FleetModel._getById(fleet_id)
    if not fleet:
        raise HTTPException(status_code=404, detail="Fleet not found")
    if fleet["userId"] != email and user_role != "admin":
        raise HTTPException(status_code=404, detail="Fleet not found")
        
    routines = RoutineModel._listByFleet(fleet_id)
    for r in routines:
        r["_id"] = str(r["_id"])
    return {"routines": routines}

@workRouter.post("/{fleet_id}/routines")
async def create_fleet_routine(fleet_id: str, req: CreateRoutineRequest, auth_payload: dict = Depends(get_current_user)):
    email = auth_payload["email"]
    user_role = auth_payload.get("role", "user")
    from fastapp.utils.adminAuth import ADMIN_EMAILS
    if auth_payload.get("email") in ADMIN_EMAILS:
        user_role = "admin"
    
    fleet = FleetModel._getById(fleet_id)
    if not fleet:
        raise HTTPException(status_code=404, detail="Fleet not found")
    if fleet["userId"] != email and user_role != "admin":
        raise HTTPException(status_code=404, detail="Fleet not found")
        
    # Validate cron syntax
    import croniter
    if not croniter.croniter.is_valid(req.cronExpr):
        raise HTTPException(status_code=400, detail="Invalid cron expression")
        
    routine = RoutineModel._create(
        fleet_id=fleet_id,
        title=req.title,
        description=req.description,
        cron_expr=req.cronExpr,
        assignee_id=req.assigneeId
    )
    return {"message": "Routine created", "routine": routine}

@workRouter.delete("/routines/{routine_id}")
async def delete_routine(routine_id: str, auth_payload: dict = Depends(get_current_user)):
    # Simple check for now
    RoutineModel._delete(routine_id)
    return {"message": "Routine deleted"}

class UpdateTaskRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    assigneeId: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None

class CreateCommentRequest(BaseModel):
    content: str = Field(..., description="Markdown content of comment")

@workRouter.get("/{fleet_id}/tasks/{task_id}")
async def get_task_detail(fleet_id: str, task_id: str, auth_payload: dict = Depends(get_current_user)):
    email = auth_payload["email"]
    user_role = auth_payload.get("role", "user")
    from fastapp.utils.adminAuth import ADMIN_EMAILS
    if auth_payload.get("email") in ADMIN_EMAILS:
        user_role = "admin"
    
    fleet = FleetModel._getById(fleet_id)
    if not fleet:
        raise HTTPException(status_code=404, detail="Fleet not found")
    if fleet["userId"] != email and user_role != "admin":
        raise HTTPException(status_code=404, detail="Fleet not found")
        
    task = TaskModel._getById(task_id)
    if not task or task["fleetId"] != fleet_id:
        raise HTTPException(status_code=404, detail="Task not found")
        
    task["_id"] = str(task["_id"])
    
    # Inject assigneeRole and assigneeTitle for UI display
    if task.get("assigneeId"):
        from bson import ObjectId
        from fastapp.database import get_db
        inst = get_db()["instances"].find_one({"_id": ObjectId(task["assigneeId"])})
        if inst:
            task["assigneeRole"] = inst.get("fleetRole", inst.get("role", "Agent"))
            task["assigneeTitle"] = inst.get("title", inst.get("alias", "Employee"))
            task["assigneeIp"] = inst.get("externalIp")
            task["assigneeAgentType"] = inst.get("iteration", "openclaw")
            task["assigneeToken"] = inst.get("dashboardToken")
            task["assigneeStatus"] = inst.get("status")
            
    return {"task": task}

@workRouter.patch("/{fleet_id}/tasks/{task_id}")
async def update_task(fleet_id: str, task_id: str, req: UpdateTaskRequest, auth_payload: dict = Depends(get_current_user)):
    email = auth_payload["email"]
    user_role = auth_payload.get("role", "user")
    from fastapp.utils.adminAuth import ADMIN_EMAILS
    if auth_payload.get("email") in ADMIN_EMAILS:
        user_role = "admin"
    
    fleet = FleetModel._getById(fleet_id)
    if not fleet:
        raise HTTPException(status_code=404, detail="Fleet not found")
    if fleet["userId"] != email and user_role != "admin":
        raise HTTPException(status_code=404, detail="Fleet not found")
        
    task = TaskModel._getById(task_id)
    if not task or task["fleetId"] != fleet_id:
        raise HTTPException(status_code=404, detail="Task not found")
        
    update_data = req.dict(exclude_unset=True)
    if not update_data:
        return {"message": "No changes", "task": task}

    # Strict status transition logic for humans
    if "status" in update_data and update_data["status"] != task.get("status"):
        old_status = task.get("status", "todo")
        new_status = update_data["status"]

        # CRITICAL GUARD: Human CANNOT manually set a parent task to 'todo' or 'done' or 'in_review' if it has unresolved delegated subtasks
        if new_status in ("todo", "done", "in_review"):
            active_subtasks = list(TaskModel._collection().find({
                "parentTaskId": task_id,
                "status": {"$nin": ["done", "cancelled", "failed"]}
            }))
            if active_subtasks:
                raise HTTPException(
                    status_code=400,
                    detail=f"This task is blocked waiting for {len(active_subtasks)} active/pending delegated subtask(s). Humans cannot manually override its blocked status until the subtasks are completed or cancelled."
                )

        # Validate transition states
        if old_status in ("todo", "in_progress", "blocked", "failed") and new_status == "cancelled":
            # allowed: processing/pending/blocked/failed -> cancel
            pass
        elif old_status == "backlog" and new_status == "todo":
            # allowed: backlog -> todo
            pass
        elif old_status == "in_review" and new_status in ("todo", "done"):
            # allowed: in_review -> done/todo
            pass
        elif old_status in ("blocked", "failed", "cancelled") and new_status == "todo":
            # allowed: blocked/failed/cancelled -> todo (re-open / retry)
            pass
        else:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid status transition for human operator: '{old_status}' to '{new_status}'. Only allowed: processing/pending/blocked/failed -> cancel; backlog -> todo; in_review -> done/todo; blocked/failed/cancelled -> todo."
            )
        
    from fastapp.database import get_db
    get_db()["tasks"].update_one(
        {"_id": task_id},
        {"$set": update_data}
    )
    
    # Evaluate dynamic transition triggers (peer blockers and parent fan-outs) for humans as well
    if "status" in update_data:
        TaskModel._evaluate_transitions(task_id, update_data["status"], task.get("result"), "human")
    
    updated_task = TaskModel._getById(task_id)
    updated_task["_id"] = str(updated_task["_id"])
    return {"message": "Task updated", "task": updated_task}

@workRouter.get("/{fleet_id}/tasks/{task_id}/comments")
async def get_task_comments(fleet_id: str, task_id: str, auth_payload: dict = Depends(get_current_user)):
    email = auth_payload["email"]
    user_role = auth_payload.get("role", "user")
    from fastapp.utils.adminAuth import ADMIN_EMAILS
    if auth_payload.get("email") in ADMIN_EMAILS:
        user_role = "admin"
    
    fleet = FleetModel._getById(fleet_id)
    if not fleet:
        raise HTTPException(status_code=404, detail="Fleet not found")
    if fleet["userId"] != email and user_role != "admin":
        raise HTTPException(status_code=404, detail="Fleet not found")
        
    from fastapp.models.commentModel import CommentModel
    comments = CommentModel._listByTask(task_id)
    for c in comments:
        c["_id"] = str(c["_id"])
    return {"comments": comments}

@workRouter.post("/{fleet_id}/tasks/{task_id}/comments")
async def add_task_comment(fleet_id: str, task_id: str, req: CreateCommentRequest, auth_payload: dict = Depends(get_current_user)):
    email = auth_payload["email"]
    user_role = auth_payload.get("role", "user")
    from fastapp.utils.adminAuth import ADMIN_EMAILS
    if auth_payload.get("email") in ADMIN_EMAILS:
        user_role = "admin"
    
    fleet = FleetModel._getById(fleet_id)
    if not fleet:
        raise HTTPException(status_code=404, detail="Fleet not found")
    if fleet["userId"] != email and user_role != "admin":
        raise HTTPException(status_code=404, detail="Fleet not found")
        
    task = TaskModel._getById(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
        
    from fastapp.models.commentModel import CommentModel
    # Human comment
    comment = CommentModel._create(
        fleet_id=fleet_id,
        task_id=task_id,
        author_id=email,
        author_role="human",
        content=req.content
    )
    
    # Paperclip feature parity: Human comments implicitly reopen done/blocked/failed agent tasks
    if task.get("assigneeId") and task.get("status") in ["done", "blocked", "failed"]:
        TaskModel._updateStatus(task_id, "todo")
        ActivityModel._log(
            fleet_id=fleet_id,
            instance_id=task["assigneeId"],
            task_id=task_id,
            event_type="status_change",
            content={"newStatus": "todo", "note": "Reopened by human comment"}
        )
        
    comment["_id"] = str(comment["_id"])
    return {"message": "Comment added", "comment": comment}
from pydantic import BaseModel, Field

class UpdateRoutineRequest(BaseModel):
    status: Optional[str] = Field(None, description="active or paused")
    title: Optional[str] = Field(None, description="New routine title")
    description: Optional[str] = Field(None, description="New routine instructions")
    cronExpr: Optional[str] = Field(None, description="New cron schedule expression")
    assigneeId: Optional[str] = Field(None, description="New assignee instance ID, or empty string to unassign")

@workRouter.get("/{fleet_id}/routines/{routine_id}/runs")
async def list_routine_runs(fleet_id: str, routine_id: str, auth_payload: dict = Depends(get_current_user)):
    email = auth_payload["email"]
    user_role = auth_payload.get("role", "user")
    from fastapp.utils.adminAuth import ADMIN_EMAILS
    if auth_payload.get("email") in ADMIN_EMAILS:
        user_role = "admin"
    
    fleet = FleetModel._getById(fleet_id)
    if not fleet:
        raise HTTPException(status_code=404, detail="Fleet not found")
    if fleet["userId"] != email and user_role != "admin":
        raise HTTPException(status_code=404, detail="Fleet not found")
        
    tasks = list(get_db()["tasks"].find({"routineId": routine_id}).sort("createdAt", -1))
    for t in tasks:
        t["_id"] = str(t["_id"])
    return {"runs": tasks}

@workRouter.patch("/{fleet_id}/routines/{routine_id}")
async def update_routine(fleet_id: str, routine_id: str, req: UpdateRoutineRequest, auth_payload: dict = Depends(get_current_user)):
    email = auth_payload["email"]
    user_role = auth_payload.get("role", "user")
    from fastapp.utils.adminAuth import ADMIN_EMAILS
    if auth_payload.get("email") in ADMIN_EMAILS:
        user_role = "admin"

    fleet = FleetModel._getById(fleet_id)
    if not fleet:
        raise HTTPException(status_code=404, detail="Fleet not found")
    if fleet["userId"] != email and user_role != "admin":
        raise HTTPException(status_code=404, detail="Fleet not found")

    routine = RoutineModel._getById(routine_id)
    if not routine or routine.get("fleetId") != fleet_id:
        raise HTTPException(status_code=404, detail="Routine not found")

    updates: Dict = {}
    if req.status is not None:
        if req.status not in ["active", "paused"]:
            raise HTTPException(status_code=400, detail="status must be 'active' or 'paused'")
        updates["status"] = req.status
    if req.title is not None:
        if not req.title.strip():
            raise HTTPException(status_code=400, detail="title cannot be empty")
        updates["title"] = req.title
    if req.description is not None:
        updates["description"] = req.description
    if req.cronExpr is not None:
        import croniter
        if not croniter.croniter.is_valid(req.cronExpr):
            raise HTTPException(status_code=400, detail="Invalid cron expression")
        updates["cronExpr"] = req.cronExpr
    if req.assigneeId is not None:
        updates["assigneeId"] = req.assigneeId or None

    if not updates:
        raise HTTPException(status_code=400, detail="No fields provided to update")

    RoutineModel._update(routine_id, updates)
    updated = RoutineModel._getById(routine_id)
    if updated:
        updated["_id"] = str(updated["_id"])
    return {"message": "Routine updated", "routine": updated}

@workRouter.post("/{fleet_id}/routines/{routine_id}/trigger")
async def trigger_routine(fleet_id: str, routine_id: str, auth_payload: dict = Depends(get_current_user)):
    email = auth_payload["email"]
    user_role = auth_payload.get("role", "user")
    from fastapp.utils.adminAuth import ADMIN_EMAILS
    if auth_payload.get("email") in ADMIN_EMAILS:
        user_role = "admin"
    
    fleet = FleetModel._getById(fleet_id)
    if not fleet:
        raise HTTPException(status_code=404, detail="Fleet not found")
    if fleet["userId"] != email and user_role != "admin":
        raise HTTPException(status_code=404, detail="Fleet not found")
        
    routine = RoutineModel._getById(routine_id)
    if not routine:
        raise HTTPException(status_code=404, detail="Routine not found")
        
    # Triggering a routine means creating an active Task for it right now
    task = TaskModel._create(
        fleet_id=fleet_id,
        title=routine["title"],
        description=routine["description"],
        assignee_id=routine["assigneeId"],
        status="todo",
        priority="medium",
        routine_id=routine_id
    )
    RoutineModel._updateLastRun(routine_id)
    return {"message": "Routine triggered manually", "task": task}

