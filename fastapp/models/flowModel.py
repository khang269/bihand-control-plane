from datetime import datetime, timezone
import uuid
from typing import Any, Dict, List, Optional
from fastapp.database import get_db

# Role ranking for permission comparisons - higher number = more capability.
_ROLE_RANK = {"viewer": 1, "editor": 2, "owner": 3}


class FlowModel:
    """A customer-support flow: one channel connection (Messenger Page/OA/personal account)
    plus its engagement policy, owned by the fleet rather than a specific agent instance.
    Agents are *assigned* to operate a flow (assignedInstanceId) and that assignment can
    change - the flow, its policy, and its conversation history persist independently of
    which agent currently handles it."""

    @staticmethod
    def _collection():
        return get_db()["flows"]

    @staticmethod
    def _ensureIndexes():
        FlowModel._collection().create_index([("fleetId", 1), ("status", 1)])
        # Sparse: only business-tier flows have pageId/oaId; personal-tier flows don't.
        FlowModel._collection().create_index([("platform", 1), ("pageId", 1)], sparse=True)
        FlowModel._collection().create_index([("platform", 1), ("oaId", 1)], sparse=True)

    @staticmethod
    def _create(
        fleet_id: str,
        name: str,
        platform: str,
        channel_type: str,
        created_by: str,
        assigned_instance_id: Optional[str] = None,
        page_id: Optional[str] = None,
        oa_id: Optional[str] = None,
        verify_token: Optional[str] = None,
        credential_id: Optional[str] = None,
        label: Optional[str] = None,
        support_policy: Optional[Dict[str, Any]] = None,
        stages: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict:
        doc = {
            "_id": str(uuid.uuid4()),
            "fleetId": fleet_id,
            "name": name,
            "platform": platform,  # 'messenger' | 'zalo'
            "channelType": channel_type,  # 'page_webhook' | 'oa_webhook' | 'personal_browser'
            "pageId": page_id,
            "oaId": oa_id,
            "verifyToken": verify_token,
            "credentialId": credential_id,
            "label": label,
            "supportPolicy": support_policy or {
                "mode": "draft",
                "maxMessagesPerDayPerCustomer": None,
                "spamKeywords": [],
                "optOutPhrases": [],
                "vipTags": ["VIP", "B2B"],
            },
            # Optional ordered funnel: [{key, name, goal, exitCriteria, escalateToHuman,
            # maxTurns}]. Absent/empty means "no funnel" - the dispatch task's original
            # single-implicit-stage behavior, fully backward compatible with flows created
            # before this field existed.
            "stages": stages or [],
            "assignedInstanceId": assigned_instance_id,
            "createdBy": created_by,  # "instance:<id>" | "human:<email>"
            "access": [],  # [{"instanceId": ..., "role": "owner"|"editor"|"viewer", "grantedAt": ...}]
            "status": "active",
            "createdAt": datetime.now(timezone.utc),
            "updatedAt": datetime.now(timezone.utc),
        }
        FlowModel._collection().insert_one(doc)
        return doc

    @staticmethod
    def _getById(flow_id: str) -> Optional[Dict]:
        return FlowModel._collection().find_one({"_id": flow_id})

    @staticmethod
    def _listByFleet(fleet_id: str) -> List[Dict]:
        return list(FlowModel._collection().find({"fleetId": fleet_id}).sort("createdAt", -1))

    @staticmethod
    def _listAccessibleByInstance(fleet_id: str, instance_id: str) -> List[Dict]:
        """Flows a given agent can see: created it, or explicitly granted access."""
        return list(FlowModel._collection().find({
            "fleetId": fleet_id,
            "$or": [
                {"createdBy": f"instance:{instance_id}"},
                {"access.instanceId": instance_id},
                {"assignedInstanceId": instance_id},
            ],
        }).sort("createdAt", -1))

    @staticmethod
    def _findByChannelId(platform: str, id_field: str, external_id: str) -> Optional[Dict]:
        """Resolve the owning flow for an inbound webhook event. id_field is 'pageId' or
        'oaId'."""
        return FlowModel._collection().find_one({
            "platform": platform,
            id_field: external_id,
            "status": "active",
        })

    @staticmethod
    def _update(flow_id: str, fields: Dict[str, Any]) -> None:
        allowed_keys = {"name", "supportPolicy", "assignedInstanceId", "status", "credentialId", "verifyToken", "pageId", "oaId", "label", "stages"}
        sanitized = {k: v for k, v in fields.items() if k in allowed_keys}
        if not sanitized:
            return
        sanitized["updatedAt"] = datetime.now(timezone.utc)
        FlowModel._collection().update_one({"_id": flow_id}, {"$set": sanitized})

    @staticmethod
    def _delete(flow_id: str) -> None:
        FlowModel._collection().delete_one({"_id": flow_id})

    @staticmethod
    def _grantAccess(flow_id: str, instance_id: str, role: str = "viewer") -> None:
        if role not in _ROLE_RANK:
            role = "viewer"
        FlowModel._collection().update_one(
            {"_id": flow_id},
            {"$pull": {"access": {"instanceId": instance_id}}}
        )
        FlowModel._collection().update_one(
            {"_id": flow_id},
            {
                "$push": {"access": {"instanceId": instance_id, "role": role, "grantedAt": datetime.now(timezone.utc)}},
                "$set": {"updatedAt": datetime.now(timezone.utc)},
            }
        )

    @staticmethod
    def _revokeAccess(flow_id: str, instance_id: str) -> None:
        FlowModel._collection().update_one(
            {"_id": flow_id},
            {"$pull": {"access": {"instanceId": instance_id}}, "$set": {"updatedAt": datetime.now(timezone.utc)}}
        )

    @staticmethod
    def _hasPermission(flow: Dict, instance_id: str, level: str) -> bool:
        """level: 'viewer' | 'editor' | 'owner'. createdBy always counts as owner."""
        if not flow or not instance_id:
            return False
        needed = _ROLE_RANK.get(level, 3)
        if flow.get("createdBy") == f"instance:{instance_id}":
            return True
        for grant in flow.get("access", []) or []:
            if grant.get("instanceId") == instance_id and _ROLE_RANK.get(grant.get("role"), 0) >= needed:
                return True
        return False
