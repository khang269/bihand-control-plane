from datetime import datetime, timezone
import uuid
from typing import Dict, List, Optional
from fastapp.database import get_db

class CommentModel:
    @staticmethod
    def _collection():
        return get_db()["comments"]
        
    @staticmethod
    def _create(fleet_id: str, task_id: str, author_id: str, author_role: str, content: str) -> Dict:
        doc = {
            "_id": str(uuid.uuid4()),
            "fleetId": fleet_id,
            "taskId": task_id,
            "authorId": author_id, # Can be userId or instanceId
            "authorRole": author_role, # 'human', 'CEO', 'CTO', etc
            "content": content,
            "createdAt": datetime.now(timezone.utc)
        }
        CommentModel._collection().insert_one(doc)
        return doc
        
    @staticmethod
    def _listByTask(task_id: str) -> List[Dict]:
        return list(CommentModel._collection().find({"taskId": task_id}).sort("createdAt", 1))
