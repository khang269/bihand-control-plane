from datetime import datetime, timezone
import uuid
from typing import Dict, List, Optional
from fastapp.database import get_db

class TaskModel:
    @staticmethod
    def _collection():
        return get_db()["tasks"]
        
    @staticmethod
    def _create(fleet_id: str, title: str, description: str, assignee_id: Optional[str] = None, parent_task_id: Optional[str] = None, goal_id: Optional[str] = None, priority: str = "none", status: str = "todo", routine_id: Optional[str] = None, creator_id: Optional[str] = None, blocked_by_ids: Optional[List[str]] = None) -> Dict:
        """Create a new task (ticket) in the fleet's backlog"""
        task_id = str(uuid.uuid4())
        identifier = f"TSK-{task_id[:6].upper()}"
        priority_map = {"none": 0, "low": 1, "medium": 2, "high": 3, "critical": 4}
        priority_value = priority_map.get(priority, 0)
        
        doc = {
            "_id": task_id,
            "identifier": identifier,
            "fleetId": fleet_id,
            "goalId": goal_id,
            "routineId": routine_id,
            "assigneeId": assignee_id, # The instance ID of the agent assigned
            "title": title,
            "description": description,
            "status": "blocked" if blocked_by_ids else status, # backlog, todo, in_progress, in_review, done, blocked, cancelled, failed
            "priority": priority, # none, low, medium, high, critical
            "priorityValue": priority_value,
            "parentTaskId": parent_task_id,
            "creatorId": creator_id,
            "result": None,
            "blockedByIds": blocked_by_ids or [],  # List of task IDs this task is waiting on
            "createdAt": datetime.now(timezone.utc),
            "updatedAt": datetime.now(timezone.utc)
        }
        TaskModel._collection().insert_one(doc)
        return doc
        
    @staticmethod
    def _getById(task_id: str) -> Optional[Dict]:
        return TaskModel._collection().find_one({"_id": task_id})
        
    @staticmethod
    def _listByFleet(fleet_id: str) -> List[Dict]:
        return list(TaskModel._collection().find({"fleetId": fleet_id, "archived": {"$ne": True}}).sort("createdAt", -1))

    @staticmethod
    def _getNextForAgent(fleet_id: str, instance_id: str) -> Optional[Dict]:
        """Atomically find the next available task for an agent and mark it in_progress. Prioritizes higher priorityValue."""
        # SELF-HEALING SAFETY GATE: If the agent is requesting a new task, but they have a task currently stuck
        # in "in_progress" status in the database, it means the agent's local runtime lost track of it (e.g., due to tunnel drops).
        # We automatically revert that stuck "in_progress" task back to "todo" so it can be cleanly checked out again.
        TaskModel._collection().update_many(
            {"fleetId": fleet_id, "assigneeId": instance_id, "status": "in_progress"},
            {"$set": {"status": "todo", "updatedAt": datetime.now(timezone.utc)}}
        )

        _unblocked = {"$or": [{"blockedByIds": {"$exists": False}}, {"blockedByIds": []}]}
        # First try to find tasks specifically assigned to this agent in todo
        task = TaskModel._collection().find_one_and_update(
            {"fleetId": fleet_id, "assigneeId": instance_id, "status": "todo", "archived": {"$ne": True}, **_unblocked},
            {"$set": {"status": "in_progress", "updatedAt": datetime.now(timezone.utc)}},
            sort=[("priorityValue", -1), ("createdAt", 1)]
        )
        
        # If no assigned tasks, grab any unassigned todo task.
        # CRITICAL SAFEGUARD: To preserve corporate hierarchy and delegation control flow,
        # a subordinate agent (anyone who reports to another agent or has reportsTo set)
        # must NEVER pull/auto-assign unassigned tasks from the general backlog pool.
        # Only top-level root entities (e.g., the CEO, who has reportsTo=None/null) are allowed to auto-checkout unassigned tasks.
        if not task:
            from bson import ObjectId
            from fastapp.models.instanceModel import InstanceModel
            try:
                db_id = ObjectId(instance_id) if isinstance(instance_id, str) else instance_id
            except Exception:
                db_id = instance_id
            
            agent_instance = InstanceModel._collection().find_one({"_id": db_id})
            reports_to = agent_instance.get("reportsTo") if agent_instance else None
            
            # If the current polling agent is a subordinate (reports to someone), they cannot auto-assign unassigned general backlog tasks.
            if reports_to:
                return None

            task = TaskModel._collection().find_one_and_update(
                {"fleetId": fleet_id, "assigneeId": None, "status": "todo", "archived": {"$ne": True}, **_unblocked},
                {"$set": {"status": "in_progress", "assigneeId": instance_id, "updatedAt": datetime.now(timezone.utc)}},
                sort=[("priorityValue", -1), ("createdAt", 1)]
            )
        return task
        
    @staticmethod
    def _updateStatus(task_id: str, status: str, result: Optional[str] = None) -> None:
        update_data = {"status": status, "updatedAt": datetime.now(timezone.utc)}
        if result is not None:
            update_data["result"] = result
            
        TaskModel._collection().update_one(
            {"_id": task_id},
            {"$set": update_data}
        )

    @staticmethod
    def _evaluate_transitions(task_id: str, new_status: str, result: Optional[str] = None, updater_instance_id: Optional[str] = None) -> None:
        """
        Evaluate and resolve peer blockers and parent task fan-out states when a task status changes.
        This handles both agent updates (done, blocked, in_review) and human updates (cancelled, done, todo).
        """
        from datetime import datetime, timezone
        from fastapp.database import get_db
        from fastapp.models.commentModel import CommentModel
        from fastapp.models.activityModel import ActivityModel
        
        db = get_db()
        task = TaskModel._getById(task_id)
        if not task:
            return
            
        fleet_id = task.get("fleetId")
        instance_id = updater_instance_id or task.get("assigneeId") or "system"
        
        # --- Retry mechanism for failed subtasks ---
        if new_status == "failed" and task.get("parentTaskId"):
            retry_count = task.get("retryCount", 0)
            max_retries = 2
            if retry_count < max_retries:
                new_retry_count = retry_count + 1
                db["tasks"].update_one(
                    {"_id": task_id},
                    {"$set": {"retryCount": new_retry_count, "status": "todo", "updatedAt": datetime.now(timezone.utc)}}
                )
                
                # Log system comments/activity about the retry
                CommentModel._create(
                    fleet_id=fleet_id,
                    task_id=task_id,
                    author_id="system",
                    author_role="System",
                    content=(
                        f"⚠️ **Subtask failed** — resetting status to `todo` for retry.\n\n"
                        f"**Error Details:** {result or 'No details'}\n"
                        f"**Retry Attempt:** {new_retry_count} / {max_retries}"
                    )
                )
                CommentModel._create(
                    fleet_id=fleet_id,
                    task_id=task.get("parentTaskId"),
                    author_id="system",
                    author_role="System",
                    content=(
                        f"⚠️ **Subtask #{task_id} failed** — Automatically retrying...\n\n"
                        f"**Subtask Title:** {task.get('title', 'Untitled')}\n"
                        f"**Error Details:** {result or 'No details'}\n"
                        f"**Retry Attempt:** {new_retry_count} / {max_retries}"
                    )
                )
                ActivityModel._log(
                    fleet_id, instance_id, task_id, "status_change",
                    {"note": f"Subtask failed. Automatically resetting to todo (Attempt {new_retry_count}/{max_retries})"}
                )
                
                # Re-evaluate parent task blocked status by calling evaluate_transitions with the new "todo" status
                # This ensures the parent task continues to see this subtask as pending / todo.
                TaskModel._evaluate_transitions(task_id, "todo", result, updater_instance_id)
                return

        # --- Cascading Cancellation of Delegated Subtasks ---
        if new_status == "cancelled":
            active_subtasks = list(db["tasks"].find({
                "parentTaskId": task_id,
                "status": {"$nin": ["done", "cancelled", "failed"]}
            }))
            for sub in active_subtasks:
                sub_id = sub["_id"]
                logger.info(f"Cascading cancellation from parent task {task_id} to subtask {sub_id}")
                db["tasks"].update_one(
                    {"_id": sub_id},
                    {"$set": {
                        "status": "cancelled",
                        "result": "Cancelled automatically because the parent task was cancelled.",
                        "updatedAt": datetime.now(timezone.utc)
                    }}
                )
                CommentModel._create(
                    fleet_id=fleet_id,
                    task_id=sub_id,
                    author_id="system",
                    author_role="System",
                    content="🚫 **Task Cancelled** — This subtask was automatically cancelled because its parent task was cancelled."
                )
                ActivityModel._log(
                    fleet_id=fleet_id,
                    instance_id="system",
                    task_id=sub_id,
                    event_type="status_change",
                    content={"newStatus": "cancelled", "note": "Cancelled automatically because parent was cancelled"}
                )
                # Recursively evaluate transitions for this subtask to handle its own children or peer blockers
                TaskModel._evaluate_transitions(sub_id, "cancelled", "Parent task cancelled", "system")

        # --- 1. Terminal State Peer-Blocker Resolution ---
        if new_status in ("done", "cancelled", "failed"):
            peer_blocked = list(db["tasks"].find({"fleetId": fleet_id, "blockedByIds": task_id}))
            for blocked_task in peer_blocked:
                db["tasks"].update_one(
                    {"_id": blocked_task["_id"]},
                    {"$pull": {"blockedByIds": task_id}, "$set": {"updatedAt": datetime.now(timezone.utc)}}
                )
                updated = db["tasks"].find_one({"_id": blocked_task["_id"]})
                if updated and len(updated.get("blockedByIds", [])) == 0:
                    from bson import ObjectId
                    s_assignee_id = task.get("assigneeId")
                    try:
                        db_id = ObjectId(s_assignee_id) if isinstance(s_assignee_id, str) else s_assignee_id
                    except Exception:
                        db_id = s_assignee_id
                    s_instance = db["instances"].find_one({"_id": db_id}) if db_id else None
                    s_role = s_instance.get("fleetRole", "Subordinate") if s_instance else "Subordinate"
                    s_role_clean = s_role.replace(" ", "_")
                    deliverables_folder = f"deliverables/from_{s_role_clean}"

                    unblock_comment_content = (
                        f"✅ **All blockers resolved** — this task is now unblocked and ready for pickup.\n\n"
                        f"**Resolved blocker:** {task.get('title', task_id)} ({new_status})\n"
                        f"**Deliverables Folder:** `{deliverables_folder}/` (All files have been automatically synced to this directory)\n\n"
                        f"**Result:** {result or 'No result'}"
                    )

                    # Perform fallback workspace realization sync to newly unblocked agent VM
                    real_source_id = instance_id if instance_id != "human" else task.get("assigneeId")
                    if blocked_task.get("assigneeId") and real_source_id and blocked_task.get("assigneeId") != real_source_id:
                        from fastapp.tasks import realize_workspace_sync_task
                        # Defer unblocking of the sibling task until the workspace files are fully copied to prevent race conditions
                        realize_workspace_sync_task.delay(real_source_id, blocked_task["assigneeId"], blocked_task["_id"], "todo", unblock_comment_content)
                        
                        CommentModel._create(
                            fleet_id=fleet_id,
                            task_id=blocked_task["_id"],
                            author_id="system",
                            author_role="System",
                            content=(
                                f"✅ **All blockers resolved** — Synchronization of files is initiated.\n\n"
                                f"**Resolved blocker:** {task.get('title', task_id)} ({new_status})\n\n"
                                f"This task will automatically resume and unblock to 'todo' once files are fully copied to your workspace."
                            )
                        )
                    else:
                        TaskModel._updateStatus(blocked_task["_id"], "todo", unblock_comment_content)
                        CommentModel._create(
                            fleet_id=fleet_id,
                            task_id=blocked_task["_id"],
                            author_id="system",
                            author_role="System",
                            content=unblock_comment_content
                        )
                        
                    ActivityModel._log(fleet_id, instance_id, blocked_task["_id"], "status_change",
                        {"note": f"Unblocked: blocker task '{task.get('title', task_id)}' marked as {new_status}"})

        # --- 2. Parent Task Fan-out Evaluation ---
        if task.get("parentTaskId"):
            parent_id = task["parentTaskId"]
            parent_task = TaskModel._getById(parent_id)
            
            if parent_task:
                siblings = list(TaskModel._collection().find({
                    "parentTaskId": parent_id,
                    "_id": {"$ne": task_id}  # exclude the current task (status already updated)
                }))
                
                all_siblings = siblings + [{"_id": task_id, "status": new_status, "result": result, "title": task.get("title")}]
                
                if new_status in ("done", "cancelled", "failed"):
                    if parent_task.get("status") in ("blocked", "done"):
                        all_siblings_terminal = all(
                            s["status"] in ("done", "cancelled", "failed") for s in all_siblings
                        )
                        if all_siblings_terminal:
                            # All subtasks finished — build aggregated summary and resume parent
                            summaries = []
                            for s in all_siblings:
                                s_status = s["status"]
                                s_title = s.get("title", "Untitled")
                                s_res = s.get("result") or "No result"
                                emoji = "✅" if s_status == "done" else "❌"
                                summaries.append(f"- {emoji} **{s_title}** [{s_status}]: {s_res}")
                                
                            aggregated_result = "✅ All subtasks completed — ready for CEO synthesis.\n\n" + "\n".join(summaries)
                            
                            # Gather last subtask role for context
                            from bson import ObjectId
                            s_assignee_id = task.get("assigneeId")
                            try:
                                db_id = ObjectId(s_assignee_id) if isinstance(s_assignee_id, str) else s_assignee_id
                            except Exception:
                                db_id = s_assignee_id
                            s_instance = db["instances"].find_one({"_id": db_id}) if db_id else None
                            s_role = s_instance.get("fleetRole", "Subordinate") if s_instance else "Subordinate"
                            s_role_clean = s_role.replace(" ", "_")
                            
                            # Sync workspace back to the parent task assignee (e.g. CEO)
                            real_source_id = instance_id if instance_id != "human" else task.get("assigneeId")
                            if parent_task.get("assigneeId") and real_source_id and parent_task.get("assigneeId") != real_source_id:
                                from fastapp.tasks import realize_workspace_sync_task
                                # We do NOT unblock the parent status until the workspace files are fully copied to prevent race conditions!
                                realize_workspace_sync_task.delay(real_source_id, parent_task["assigneeId"], parent_id, "todo", aggregated_result)
                                
                                CommentModel._create(
                                    fleet_id=fleet_id,
                                    task_id=parent_id,
                                    author_id="system",
                                    author_role="System",
                                    content=(
                                        f"✅ **All subtasks completed** — Synchronization of files is initiated.\n\n"
                                        f"**Results:**\n" + "\n".join(summaries) + "\n\n"
                                        f"The parent task will automatically resume and unblock once files are fully copied to your workspace."
                                    )
                                )
                            else:
                                TaskModel._updateStatus(parent_id, "todo", aggregated_result)
                                CommentModel._create(
                                    fleet_id=fleet_id,
                                    task_id=parent_id,
                                    author_id="system",
                                    author_role="System",
                                    content=(
                                        f"✅ **All subtasks completed** — parent task is now resuming.\n\n"
                                        f"**Results:**\n" + "\n".join(summaries)
                                    )
                                )
                        else:
                            # Some siblings still in progress — update count and post progress comment
                            pending = [s for s in all_siblings if s["status"] not in ("done", "cancelled", "failed")]
                            remaining = len(pending)
                            total = len(all_siblings)
                            pending_list = "\n".join([
                                f"- ⏳ **{s.get('title', 'Untitled')}** (status: {s['status']})"
                                for s in pending
                            ])
                            TaskModel._updateStatus(
                                parent_id, "blocked",
                                f"Waiting for delegated subtask(s): {remaining} pending"
                            )
                            CommentModel._create(
                                fleet_id=fleet_id,
                                task_id=parent_id,
                                author_id="system",
                                author_role="System",
                                content=(
                                    f"✅ **Subtask status updated** ({total - remaining}/{total} terminal) — waiting for {remaining} more.\n\n"
                                    f"**Updated:** {task.get('title', task_id)} -> {new_status}\n"
                                    f"**Result:** {result or 'No result'}\n\n"
                                    f"**Still pending:**\n{pending_list}"
                                )
                            )
                            
                elif new_status in ("todo", "in_progress", "blocked", "failed", "backlog"):
                    # Case 1: The parent task is currently active/done/in_review/cancelled, so we must block it
                    if parent_task.get("status") in ("todo", "in_progress", "done", "in_review", "cancelled"):
                        reason = f"Waiting for delegated subtask(s): 1 pending"
                        TaskModel._updateStatus(parent_id, "blocked", reason)
                        CommentModel._create(
                            fleet_id=fleet_id,
                            task_id=parent_id,
                            author_id="system",
                            author_role="System",
                            content=(
                                f"⚠️ **Parent task blocked/reactivated** — Subtask #{task_id} has transitioned back to `{new_status}`.\n\n"
                                f"**Subtask Title:** {task.get('title', 'Untitled')}\n\n"
                                f"Parent task is now blocked and paused until all subtasks are completed or cancelled."
                            )
                        )
                        ActivityModel._log(
                            fleet_id=fleet_id,
                            instance_id=instance_id,
                            task_id=parent_id,
                            event_type="status_change",
                            content={"newStatus": "blocked", "note": f"Blocked: Subtask {task_id} reset to {new_status}"}
                        )
                    # Case 2: The parent is already blocked, so we just update the pending list comment
                    elif parent_task.get("status") == "blocked":
                        pending = [s for s in all_siblings if s["status"] not in ("done", "cancelled", "failed")]
                        remaining = len(pending)
                        total = len(all_siblings)
                        pending_list = "\n".join([
                            f"- ⏳ **{s.get('title', 'Untitled')}** (status: {s['status']})"
                            for s in pending
                        ])
                        TaskModel._updateStatus(
                            parent_id, "blocked",
                            f"Waiting for delegated subtask(s): {remaining} pending"
                        )
                        CommentModel._create(
                            fleet_id=fleet_id,
                            task_id=parent_id,
                            author_id="system",
                            author_role="System",
                            content=(
                                f"🔄 **Subtask status updated** — subtask `{task_id}` was updated to `{new_status}`.\n\n"
                                f"**Still pending:**\n{pending_list}"
                            )
                        )
                            
                elif new_status == "in_review":
                    if parent_task.get("status") == "blocked":
                        all_siblings_terminal_or_review = all(
                            s["status"] in ("done", "cancelled", "failed", "in_review") for s in all_siblings
                        )
                        if all_siblings_terminal_or_review:
                            from bson import ObjectId
                            s_assignee_id = task.get("assigneeId")
                            try:
                                db_id = ObjectId(s_assignee_id) if isinstance(s_assignee_id, str) else s_assignee_id
                            except Exception:
                                db_id = s_assignee_id
                            s_instance = db["instances"].find_one({"_id": db_id}) if db_id else None
                            s_role = s_instance.get("fleetRole", "Subordinate") if s_instance else "Subordinate"
                            s_role_clean = s_role.replace(" ", "_")
                            
                            parent_unblock_content = (
                                f"🔔 **All subtasks ready/completed** — resuming parent task for review.\n\n"
                                f"Subtask `{task_id}` was submitted for review.\n"
                                f"Its physical deliverables have been automatically synchronized into `deliverables/from_{s_role_clean}/` in your workspace."
                            )

                            # Sync workspace back to parent task assignee (e.g. CEO) when subtasks are ready for review
                            real_source_id = instance_id if instance_id != "human" else task.get("assigneeId")
                            if parent_task.get("assigneeId") and real_source_id and parent_task.get("assigneeId") != real_source_id:
                                from fastapp.tasks import realize_workspace_sync_task
                                # Defer unblocking of the parent task until the workspace files are fully copied to prevent race conditions
                                realize_workspace_sync_task.delay(real_source_id, parent_task["assigneeId"], parent_id, "todo", parent_unblock_content)
                                
                                CommentModel._create(
                                    fleet_id=fleet_id,
                                    task_id=parent_id,
                                    author_id="system",
                                    author_role="System",
                                    content=(
                                        f"🔔 **All subtasks ready/completed** — Synchronization of files is initiated.\n\n"
                                        f"Subtask `{task_id}` was submitted for review.\n"
                                        f"The parent task will automatically resume and unblock once files are fully copied to your workspace."
                                    )
                                )
                            else:
                                TaskModel._updateStatus(parent_id, "todo", parent_unblock_content)
                                CommentModel._create(
                                    fleet_id=fleet_id,
                                    task_id=parent_id,
                                    author_id="system",
                                    author_role="System",
                                    content=parent_unblock_content
                                )
                        else:
                            # Parent stays blocked, post progress comment
                            pending_siblings = [s for s in all_siblings if s["status"] not in ("done", "cancelled", "failed", "in_review")]
                            remaining = len(pending_siblings)
                            pending_list = "\n".join([f"- ⏳ **{s.get('title', 'Untitled')}** (status: {s['status']})" for s in pending_siblings])
                            CommentModel._create(
                                fleet_id=fleet_id,
                                task_id=parent_id,
                                author_id="system",
                                author_role="System",
                                content=f"🔔 **Subtask Submitted for Review**\n\nSubtask `{task_id}` has been submitted for review. Still waiting for {remaining} pending subtask(s):\n{pending_list}"
                            )
