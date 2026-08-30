import uuid
import json
import base64
from datetime import datetime, timezone
from typing import Dict, List, Optional, Any
from fastapp.appConfig import getAppConfig
import os

from fastapp.database import get_db, encrypt_field, decrypt_field

app_config = getAppConfig(os.environ.get("ENV", "prod"))

class CredentialModel:
    @staticmethod
    def _collection():
        return get_db()["credentials"]
        
    @staticmethod
    def encrypt_data(data: str) -> Any:
        return encrypt_field(data)
        
    @staticmethod
    def decrypt_data(encrypted_val) -> str:
        try:
            return decrypt_field(encrypted_val)
        except Exception as e:
            return ""

    @staticmethod
    def create(user_id: str, name: str, cred_type: str, data: str) -> Dict:
        cred_id = str(uuid.uuid4())
        doc = {
            "_id": cred_id,
            "userId": user_id,
            "name": name,
            "type": cred_type, # e.g. 'llm_api_key', 'google_workspace'
            "data": CredentialModel.encrypt_data(data),
            "createdAt": datetime.now(timezone.utc),
            "updatedAt": datetime.now(timezone.utc)
        }
        CredentialModel._collection().insert_one(doc)
        return doc

    @staticmethod
    def update(cred_id: str, user_id: str, name: str, data: str) -> bool:
        update_doc = {
            "name": name,
            "updatedAt": datetime.now(timezone.utc)
        }
        if data:
            update_doc["data"] = CredentialModel.encrypt_data(data)
            
        res = CredentialModel._collection().update_one(
            {"_id": cred_id, "userId": user_id},
            {"$set": update_doc}
        )
        return res.modified_count > 0

    @staticmethod
    def get_by_id(cred_id: str) -> Optional[Dict]:
        doc = CredentialModel._collection().find_one({"_id": cred_id})
        if doc:
            doc["decrypted_data"] = CredentialModel.decrypt_data(doc["data"])
        return doc

    @staticmethod
    def list_by_user(user_id: str) -> List[Dict]:
        # Exclude temporary pending OAuth credentials from being listed as active
        docs = list(CredentialModel._collection().find({
            "userId": user_id,
            "status": {"$ne": "pending_oauth"}
        }).sort("createdAt", -1))
        # Mask the data for safe UI transport
        for d in docs:
            d["data"] = "***"
        return docs
        
    @staticmethod
    def delete(cred_id: str, user_id: str) -> bool:
        res = CredentialModel._collection().delete_one({"_id": cred_id, "userId": user_id})
        return res.deleted_count > 0

