from datetime import datetime, timezone
import uuid
from typing import Dict, List, Any
from fastapp.database import get_db

class ActivityModel:
    @staticmethod
    def _collection():
        return get_db()["activities"]
        
    @staticmethod
    def _log(fleet_id: str, instance_id: str, task_id: str, event_type: str, content: Dict[str, Any]) -> Dict:
        """
        Record an immutable event in the audit trail.
        event_type: 'thought', 'tool_call', 'message', 'error', 'status_change'
        """
        doc = {
            "_id": str(uuid.uuid4()),
            "fleetId": fleet_id,
            "instanceId": instance_id,
            "taskId": task_id,
            "eventType": event_type,
            "content": content,
            "timestamp": datetime.now(timezone.utc)
        }
        ActivityModel._collection().insert_one(doc)
        return doc
        
    @staticmethod
    def _listByFleet(fleet_id: str, limit: int = 100) -> List[Dict]:
        return list(ActivityModel._collection().find({"fleetId": fleet_id}).sort("timestamp", -1).limit(limit))

    @staticmethod
    def _listByTask(task_id: str) -> List[Dict]:
        return list(ActivityModel._collection().find({"taskId": task_id}).sort("timestamp", 1))
