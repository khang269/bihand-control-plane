from datetime import datetime, timezone
import uuid
from typing import Any, Dict, List, Optional
from pymongo import ReturnDocument
from fastapp.database import get_db

class ConversationModel:
    @staticmethod
    def _collection():
        return get_db()["conversations"]

    @staticmethod
    def _ensureIndexes():
        ConversationModel._collection().create_index(
            [("fleetId", 1), ("platform", 1), ("externalThreadId", 1)], unique=True
        )
        ConversationModel._collection().create_index([("fleetId", 1), ("status", 1)])
        ConversationModel._collection().create_index([("flowId", 1)])

    @staticmethod
    def _getOrCreateActive(
        fleet_id: str,
        flow_id: str,
        customer_profile_id: str,
        platform: str,
        channel_type: str,
        external_thread_id: str,
        default_mode: str = "draft",
        initial_stage_key: Optional[str] = None,
    ) -> Dict:
        """One long-lived thread per (fleet, platform, externalThreadId). Reopens an existing
        thread rather than creating a duplicate - this is a distinct model from Task/Comment
        deliberately: many of these can be concurrently active per agent, unlike a Task's
        single atomic checkout, and only bounded recent history is ever re-injected here.

        Stores flowId, not a fixed instanceId - the attributed/operating agent is resolved
        dynamically through Flow.assignedInstanceId at dispatch time, so reassigning a flow
        to a different agent immediately affects all its conversations, not just new ones.

        initial_stage_key: the flow's first stage key if it has a funnel configured, else
        None - callers pass this rather than ConversationModel importing FlowModel, keeping
        the two decoupled the same way they already are elsewhere in this file."""
        existing = ConversationModel._collection().find_one({
            "fleetId": fleet_id, "platform": platform, "externalThreadId": external_thread_id,
        })
        if existing:
            if existing.get("status") != "active":
                ConversationModel._collection().update_one(
                    {"_id": existing["_id"]},
                    {"$set": {"status": "active", "updatedAt": datetime.now(timezone.utc)}}
                )
                existing["status"] = "active"
            return existing

        doc = {
            "_id": str(uuid.uuid4()),
            "fleetId": fleet_id,
            "flowId": flow_id,
            "customerProfileId": customer_profile_id,
            "platform": platform,  # 'messenger' | 'zalo'
            "channelType": channel_type,  # 'page_webhook' | 'oa_webhook' | 'personal_browser'
            "externalThreadId": external_thread_id,
            "status": "active",  # active | closed
            "mode": default_mode,  # draft | auto | human_only
            "scope": "text_only",  # Phase 1: text_only | denied only
            # Funnel tracking - None/0/[] when the flow has no stages configured, in which
            # case the dispatch task's original single-implicit-stage behavior applies
            # unchanged.
            "currentStageKey": initial_stage_key,
            "stageTurnsElapsed": 0,
            "stageHistory": ([{"stageKey": initial_stage_key, "enteredAt": datetime.now(timezone.utc)}] if initial_stage_key else []),
            "lastMessageAt": datetime.now(timezone.utc),
            "createdAt": datetime.now(timezone.utc),
            "updatedAt": datetime.now(timezone.utc),
        }
        try:
            ConversationModel._collection().insert_one(doc)
        except Exception:
            existing = ConversationModel._collection().find_one({
                "fleetId": fleet_id, "platform": platform, "externalThreadId": external_thread_id,
            })
            if existing:
                return existing
            raise
        return doc

    @staticmethod
    def _getById(conversation_id: str) -> Optional[Dict]:
        return ConversationModel._collection().find_one({"_id": conversation_id})

    @staticmethod
    def _touch(conversation_id: str) -> None:
        """Bump lastMessageAt - the debounce/dispatch task compares its scheduled-at
        timestamp against this to detect whether a newer message has arrived since it was
        queued, and no-ops if so (a fresher invocation will handle it)."""
        ConversationModel._collection().update_one(
            {"_id": conversation_id},
            {"$set": {"lastMessageAt": datetime.now(timezone.utc), "updatedAt": datetime.now(timezone.utc)}}
        )

    @staticmethod
    def _advanceStage(conversation_id: str, next_stage_key: str) -> None:
        """Moves the conversation to the next stage of its flow's funnel and resets the
        stuck-conversation turn counter. Called by dispatch_conversation_reply_task when the
        model reports stage_complete=true - the backend decides which stage is "next"
        (sequential, index+1 in the flow's stage list), never the model itself."""
        now = datetime.now(timezone.utc)
        ConversationModel._collection().update_one(
            {"_id": conversation_id},
            {
                "$set": {"currentStageKey": next_stage_key, "stageTurnsElapsed": 0, "updatedAt": now},
                "$push": {"stageHistory": {"stageKey": next_stage_key, "enteredAt": now}},
            }
        )

    @staticmethod
    def _incrementStageTurns(conversation_id: str) -> int:
        """Increments and returns the new stageTurnsElapsed count - used to detect a
        conversation stuck in one stage past its maxTurns."""
        result = ConversationModel._collection().find_one_and_update(
            {"_id": conversation_id},
            {"$inc": {"stageTurnsElapsed": 1}, "$set": {"updatedAt": datetime.now(timezone.utc)}},
            return_document=ReturnDocument.AFTER,
        )
        return (result or {}).get("stageTurnsElapsed", 0)

    @staticmethod
    def _setMode(conversation_id: str, mode: str) -> None:
        ConversationModel._collection().update_one(
            {"_id": conversation_id},
            {"$set": {"mode": mode, "updatedAt": datetime.now(timezone.utc)}}
        )

    @staticmethod
    def _setScope(conversation_id: str, scope: str) -> None:
        ConversationModel._collection().update_one(
            {"_id": conversation_id},
            {"$set": {"scope": scope, "updatedAt": datetime.now(timezone.utc)}}
        )

    @staticmethod
    def _close(conversation_id: str) -> None:
        ConversationModel._collection().update_one(
            {"_id": conversation_id},
            {"$set": {"status": "closed", "updatedAt": datetime.now(timezone.utc)}}
        )

    @staticmethod
    def _listByFleet(fleet_id: str, status: Optional[str] = None) -> List[Dict]:
        query: Dict[str, Any] = {"fleetId": fleet_id}
        if status:
            query["status"] = status
        return list(ConversationModel._collection().find(query).sort("lastMessageAt", -1))
