from datetime import datetime, timezone
import uuid
from typing import Dict, List, Optional
from fastapp.database import get_db

class RunModel:
    @staticmethod
    def _collection():
        return get_db()["runs"]
        
    @staticmethod
    def _start(fleet_id: str, instance_id: str, task_id: str) -> Dict:
        """Record a new heartbeat execution attempt for an issue"""
        run_id = str(uuid.uuid4())
        doc = {
            "_id": run_id,
            "fleetId": fleet_id,
            "instanceId": instance_id,
            "taskId": task_id,
            "status": "running", # running, failed, success
            "errorDetails": None,
            "inputTokens": 0,
            "outputTokens": 0,
            "costUsd": 0.0,
            "startedAt": datetime.now(timezone.utc),
            "endedAt": None
        }
        RunModel._collection().insert_one(doc)
        return doc
        
    @staticmethod
    def _complete(run_id: str, success: bool, error_details: Optional[str] = None) -> None:
        """Mark a run as finished"""
        RunModel._collection().update_one(
            {"_id": run_id},
            {"$set": {
                "status": "success" if success else "failed",
                "errorDetails": error_details,
                "endedAt": datetime.now(timezone.utc)
            }}
        )

    @staticmethod
    def _addTokens(run_id: str, input_tokens: int, output_tokens: int, cost_usd: float) -> None:
        """Update token usage for a run"""
        RunModel._collection().update_one(
            {"_id": run_id},
            {"$inc": {
                "inputTokens": input_tokens,
                "outputTokens": output_tokens,
                "costUsd": cost_usd
            }}
        )

    @staticmethod
    def _listByInstance(instance_id: str, limit: int = 50) -> List[Dict]:
        return list(RunModel._collection().find({"instanceId": instance_id}).sort("startedAt", -1).limit(limit))
