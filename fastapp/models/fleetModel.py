from datetime import datetime, timezone
import uuid
from typing import Dict, List, Optional
from fastapp.database import get_db

class FleetModel:
    @staticmethod
    def _collection():
        return get_db()["fleets"]
        
    @staticmethod
    def _create(user_id: str, name: str, plan: str, total_price: float, agents: List[Dict], api_budget: float = 0.0, mission: str = "Execute tasks autonomously.") -> Dict:
        """Create a new company agent fleet"""
        fleet_id = str(uuid.uuid4())
        doc = {
            "_id": fleet_id,
            "userId": user_id,
            "name": name,
            "mission": mission,
            "plan": plan,
            "totalPrice": total_price,
            "apiBudget": api_budget,
            "apiSpend": 0.0,
            "agents": agents,
            "status": "provisioning",
            "bihandUrl": f"https://dashboard.bihand.com/{fleet_id}", # Placeholder SaaS URL
            "createdAt": datetime.now(timezone.utc),
            "updatedAt": datetime.now(timezone.utc)
        }
        FleetModel._collection().insert_one(doc)
        return doc
        
    @staticmethod
    def _getById(fleet_id: str) -> Optional[Dict]:
        return FleetModel._collection().find_one({"_id": fleet_id})
        
    @staticmethod
    def _listByUser(user_id: str) -> List[Dict]:
        return list(FleetModel._collection().find({"userId": user_id}).sort("createdAt", -1))
        
    @staticmethod
    def _updateStatus(fleet_id: str, status: str) -> None:
        FleetModel._collection().update_one(
            {"_id": fleet_id},
            {"$set": {"status": status, "updatedAt": datetime.now(timezone.utc)}}
        )

    @staticmethod
    def _exportTemplate(fleet_id: str) -> Optional[Dict]:
        """Export a portable company template with secrets scrubbed."""
        fleet = FleetModel._getById(fleet_id)
        if not fleet: return None
        
        # Scrub secrets from agents
        clean_agents = []
        for ag in fleet.get("agents", []):
            ag_copy = ag.copy()
            if "apiKey" in ag_copy:
                ag_copy["apiKey"] = "" # Scrubbed
            clean_agents.append(ag_copy)
            
        return {
            "templateVersion": "1.0",
            "companyName": fleet.get("name"),
            "mission": fleet.get("mission"),
            "plan": fleet.get("plan"),
            "apiBudget": fleet.get("apiBudget"),
            "agents": clean_agents
        }
