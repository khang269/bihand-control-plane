from datetime import datetime, timezone
import uuid
from typing import Dict, List, Optional
from fastapp.database import get_db

class ApprovalModel:
    @staticmethod
    def _collection():
        return get_db()["approvals"]
        
    @staticmethod
    def _request(fleet_id: str, instance_id: str, action_type: str, payload: dict, reason: str, task_id: Optional[str] = None, conversation_id: Optional[str] = None) -> Dict:
        """Create a governance gate requiring human review. Either taskId or conversationId
        (or neither, for standalone approvals) can be set - conversationId is used by the
        customer-support shadow-mode flow (actionType='send_reply'), which has no Task at all."""
        doc = {
            "_id": str(uuid.uuid4()),
            "fleetId": fleet_id,
            "instanceId": instance_id,
            "taskId": task_id,
            "conversationId": conversation_id,
            "actionType": action_type, # e.g., 'merge_code', 'execute_transaction', 'send_reply'
            "payload": payload,
            "reason": reason,
            "status": "pending", # pending, approved, rejected
            "createdAt": datetime.now(timezone.utc),
            "resolvedAt": None,
            "resolvedBy": None # user email
        }
        ApprovalModel._collection().insert_one(doc)
        return doc
        
    @staticmethod
    def _getById(approval_id: str) -> Optional[Dict]:
        return ApprovalModel._collection().find_one({"_id": approval_id})

    @staticmethod
    def _resolve(approval_id: str, status: str, user_id: str) -> None:
        ApprovalModel._collection().update_one(
            {"_id": approval_id},
            {"$set": {
                "status": status,
                "resolvedAt": datetime.now(timezone.utc),
                "resolvedBy": user_id
            }}
        )
        
    @staticmethod
    def _listPendingByFleet(fleet_id: str) -> List[Dict]:
        return list(ApprovalModel._collection().find({"fleetId": fleet_id, "status": "pending"}).sort("createdAt", -1))
