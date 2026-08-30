from datetime import datetime, timezone
import uuid
from typing import Dict, List, Optional
from fastapp.database import get_db

class ChatMessageModel:
    @staticmethod
    def _collection():
        return get_db()["chatMessages"]

    @staticmethod
    def _insert(instance_id: str, fleet_id: str, agent_type: str, kind: str, message_id: str, **fields) -> Dict:
        doc = {
            "_id": str(uuid.uuid4()),
            "instanceId": instance_id,
            "fleetId": fleet_id,
            "agentType": agent_type,
            "kind": kind,  # 'user' | 'assistant' | 'tool' | 'error'
            "messageId": message_id,
            "createdAt": datetime.now(timezone.utc),
            "updatedAt": datetime.now(timezone.utc),
        }
        doc.update(fields)
        ChatMessageModel._collection().insert_one(doc)
        return doc

    @staticmethod
    def _upsertToolResult(instance_id: str, message_id: str, output) -> None:
        ChatMessageModel._collection().update_one(
            {"instanceId": instance_id, "messageId": message_id, "kind": "tool"},
            {"$set": {
                "toolOutput": output,
                "toolStatus": "done",
                "updatedAt": datetime.now(timezone.utc),
            }},
        )

    @staticmethod
    def _listByInstance(instance_id: str, limit: int = 200) -> List[Dict]:
        # Fetch the most recent `limit` rows, then return them oldest-first for replay.
        docs = list(
            ChatMessageModel._collection()
            .find({"instanceId": instance_id})
            .sort("createdAt", -1)
            .limit(limit)
        )
        docs.reverse()

        messages = []
        for doc in docs:
            kind = doc.get("kind")
            if kind == "user":
                messages.append({"kind": "user", "id": doc["messageId"], "text": doc.get("text", "")})
            elif kind == "assistant":
                messages.append({"kind": "assistant", "id": doc["messageId"], "text": doc.get("text", "")})
            elif kind == "tool":
                messages.append({
                    "kind": "tool",
                    "id": doc["messageId"],
                    "name": doc.get("toolName", "tool"),
                    "input": doc.get("toolInput"),
                    "output": doc.get("toolOutput"),
                    "status": doc.get("toolStatus", "running"),
                    "expanded": False,
                })
            elif kind == "error":
                messages.append({"kind": "error", "id": doc["messageId"], "text": doc.get("text", "")})
        return messages

    @staticmethod
    def _recentTextTranscript(instance_id: str, limit: int = 40) -> Optional[str]:
        """Compact plain-text transcript of the most recent interactive chat turns, for prompt injection."""
        messages = ChatMessageModel._listByInstance(instance_id, limit=limit)
        if not messages:
            return None

        lines = []
        for m in messages:
            if m["kind"] == "user":
                lines.append(f"Operator: {m['text']}")
            elif m["kind"] == "assistant":
                lines.append(f"You: {m['text']}")
            elif m["kind"] == "tool":
                lines.append(f"[used tool: {m['name']}]")
            elif m["kind"] == "error":
                lines.append(f"[chat error: {m['text']}]")
        return "\n".join(lines)
