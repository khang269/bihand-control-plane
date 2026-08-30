from datetime import datetime, timezone
import uuid
from typing import Dict, List, Optional
from fastapp.database import get_db

class GoalModel:
    @staticmethod
    def _collection():
        return get_db()["goals"]
        
    @staticmethod
    def _create(fleet_id: str, title: str, description: str) -> Dict:
        """Create a high-level Company Goal"""
        goal_id = str(uuid.uuid4())
        doc = {
            "_id": goal_id,
            "fleetId": fleet_id,
            "title": title,
            "description": description,
            "status": "active", # active, completed, archived
            "createdAt": datetime.now(timezone.utc),
            "updatedAt": datetime.now(timezone.utc)
        }
        GoalModel._collection().insert_one(doc)
        return doc
        
    @staticmethod
    def _getById(goal_id: str) -> Optional[Dict]:
        return GoalModel._collection().find_one({"_id": goal_id})
        
    @staticmethod
    def _listByFleet(fleet_id: str) -> List[Dict]:
        return list(GoalModel._collection().find({"fleetId": fleet_id}).sort("createdAt", -1))
        
    @staticmethod
    def _updateStatus(goal_id: str, status: str) -> None:
        GoalModel._collection().update_one(
            {"_id": goal_id},
            {"$set": {"status": status, "updatedAt": datetime.now(timezone.utc)}}
        )
