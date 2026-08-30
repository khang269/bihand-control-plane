from datetime import datetime, timezone
import uuid
from typing import Dict, List, Optional
from fastapp.database import get_db

class RoutineModel:
    @staticmethod
    def _collection():
        return get_db()["routines"]
        
    @staticmethod
    def _create(fleet_id: str, title: str, description: str, cron_expr: str, assignee_id: Optional[str] = None, status: str = "active") -> Dict:
        """Create a recurring routine"""
        routine_id = str(uuid.uuid4())
        doc = {
            "_id": routine_id,
            "fleetId": fleet_id,
            "title": title,
            "description": description,
            "cronExpr": cron_expr, # e.g. "0 9 * * *" for 9 AM daily
            "assigneeId": assignee_id,
            "status": status,
            "lastRunAt": None,
            "createdAt": datetime.now(timezone.utc)
        }
        RoutineModel._collection().insert_one(doc)
        return doc
        
    @staticmethod
    def _listByFleet(fleet_id: str) -> List[Dict]:
        return list(RoutineModel._collection().find({"fleetId": fleet_id}).sort("createdAt", -1))

    @staticmethod
    def _getById(routine_id: str) -> Optional[Dict]:
        return RoutineModel._collection().find_one({"_id": routine_id})

    @staticmethod
    def _updateStatus(routine_id: str, status: str) -> None:
        RoutineModel._collection().update_one(
            {"_id": routine_id},
            {"$set": {"status": status}}
        )

    @staticmethod
    def _update(routine_id: str, updates: Dict) -> None:
        """Update arbitrary routine fields (title, description, cronExpr, assigneeId, status)."""
        if not updates:
            return
        RoutineModel._collection().update_one(
            {"_id": routine_id},
            {"$set": updates}
        )

    @staticmethod
    def _updateLastRun(routine_id: str) -> None:
        RoutineModel._collection().update_one(
            {"_id": routine_id},
            {"$set": {"lastRunAt": datetime.now(timezone.utc)}}
        )
    
    @staticmethod
    def _delete(routine_id: str) -> None:
        RoutineModel._collection().delete_one({"_id": routine_id})
