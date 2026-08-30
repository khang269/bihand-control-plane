from datetime import datetime, timezone
import hashlib
import uuid
from typing import Dict, List, Optional
from fastapp.database import get_db

class MessageModel:
    @staticmethod
    def _collection():
        return get_db()["messages"]

    @staticmethod
    def _ensureIndexes():
        # The idempotency guard against webhook retries (Messenger redelivers aggressively)
        # and against the debounce/dispatch path double-processing the same inbound message.
        MessageModel._collection().create_index(
            [("platform", 1), ("externalMessageId", 1)], unique=True
        )
        MessageModel._collection().create_index([("conversationId", 1), ("createdAt", 1)])

    @staticmethod
    def _syntheticExternalId(external_thread_id: str, sender_id: str, content: str, timestamp: datetime) -> str:
        """For personal-account scraping, where the platform exposes no stable message ID,
        synthesize one from thread+sender+content+timestamp rounded to the minute - stable
        enough that re-scraping the same message on the next poll cycle produces the same
        ID (so the unique index still dedupes it), but distinct across genuinely different
        messages sent close together."""
        rounded_minute = timestamp.replace(second=0, microsecond=0).isoformat()
        raw = f"{external_thread_id}:{sender_id}:{content}:{rounded_minute}"
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    @staticmethod
    def _create(
        conversation_id: str,
        platform: str,
        direction: str,
        content: str,
        external_message_id: str,
        status: str = "received",
    ) -> Optional[Dict]:
        """Insert a message. Returns None (not an exception) if externalMessageId already
        exists for this platform - the idempotent no-op path callers should treat as
        'already processed', not an error. direction: 'inbound' | 'outbound'.
        status: received | draft | approved | pending_send | sent | failed | discarded."""
        doc = {
            "_id": str(uuid.uuid4()),
            "conversationId": conversation_id,
            "platform": platform,
            "direction": direction,
            "content": content,
            "externalMessageId": external_message_id,
            "status": status,
            "createdAt": datetime.now(timezone.utc),
            "updatedAt": datetime.now(timezone.utc),
        }
        try:
            MessageModel._collection().insert_one(doc)
        except Exception:
            # Unique index rejected a duplicate (platform, externalMessageId) - already processed.
            return None
        return doc

    @staticmethod
    def _getById(message_id: str) -> Optional[Dict]:
        return MessageModel._collection().find_one({"_id": message_id})

    @staticmethod
    def _setStatus(message_id: str, status: str) -> None:
        MessageModel._collection().update_one(
            {"_id": message_id},
            {"$set": {"status": status, "updatedAt": datetime.now(timezone.utc)}}
        )

    @staticmethod
    def _recentByConversation(conversation_id: str, limit: int = 20) -> List[Dict]:
        """Bounded history only - the mistake identified with the Task/Comment path was
        injecting the FULL unbounded history into every prompt. Callers assembling the LLM
        prompt should use this, not an unlimited query."""
        return list(
            MessageModel._collection()
            .find({"conversationId": conversation_id})
            .sort("createdAt", -1)
            .limit(limit)
        )[::-1]  # re-reverse to chronological order for prompt assembly
