from fastapp.database import get_db, encrypt_field, decrypt_field

from datetime import datetime, timedelta, timezone
from typing import Optional, List, Dict
from fastapp.utils.utils import generateHash

"""
User document on mongodb: Sample
{
    "_id": "id",
    "hash": "md5-hash",
    "email": "user@example.com",
    "name": "Jane Doe",
    "avatar": "https://lh3.googleusercontent.com/a/...",
    "authProviders": [
        {
            "provider": "google", // google, facebook, github, apple, credentials
            "providerUserId": "1032849823xxxxxx"
        }
    ],
    "createdDate": ISODate(),
    "updatedDate": ISODate()
}

"""

class UserModel:

    collectionName = "users"

    @classmethod
    def _createUser(
        cls,
        hash: str, 
        email: str,
        name: str,
        avatar: str,
        authProviders: Optional[List[Dict]] = None
    ):
        """Create a new user document"""
        currentTime = datetime.now(timezone.utc)
        user = {
            "hash": hash,
            "email": email,
            "name": name,
            "avatar": avatar,
            "credits": 150, # Default 150 credits for new signups
            "authProviders": authProviders if authProviders is not None else [],
            "createdDate": currentTime,
            "updatedDate": currentTime
        }

        result = get_db()[cls.collectionName].insert_one(user)
        return cls._getUserById(result.inserted_id)

    @classmethod
    def _addAuthProvider(cls, email: str, provider: str, providerUserId: str):
        """Link a new social auth provider to an existing user."""
        db = get_db()
        currentTime = datetime.now(timezone.utc)
        
        # Only add if the provider is not already linked
        result = db[cls.collectionName].update_one(
            {
                "email": email,
                "authProviders.provider": {"$ne": provider}
            },
            {
                "$push": {
                    "authProviders": {
                        "provider": provider,
                        "providerUserId": providerUserId
                    }
                },
                "$set": {
                    "updatedDate": currentTime
                }
            }
        )
        return result.modified_count > 0

    @classmethod
    def _getUserByHash(cls, hash: str):
        """Retrieve a user by its hash."""
        db = get_db()
        user = db[cls.collectionName].find_one({"hash": hash})
        if not user:
            return None
        return cls._serializeUser(cls._decryptUser(user))
    
    @classmethod
    def _getUserByEmail(cls, email: str):
        """Retrieve a user by its email."""
        db = get_db()
        user = db[cls.collectionName].find_one({"email": email})
        if not user:
            return None
        return cls._serializeUser(cls._decryptUser(user))

    @classmethod
    def _serializeUser(cls, user: Dict) -> Dict:
        """Serialize a document by decrypting sensitive fields."""
        if not user:
            return None
        user['_id'] = str(user['_id'])
        return user
    
    @classmethod
    def _decryptUser(cls, comic: Dict) -> Dict:
        """Decrypt sensitive fields in a document."""
        if not comic:
            return None
        # comic['author'] = decrypt_field(comic.get('author'))
        return comic
    
    @classmethod
    def _getUserById(cls, id):
        """Retrieve a user by its ID."""
        db = get_db()
        user = db[cls.collectionName].find_one({"_id": id})
        if not user:
            return None
        return cls._serializeUser(cls._decryptUser(user))

    @classmethod
    def _searchUsers(cls, query: str = "", limit: int = 20):
        """Search users by name or email substring. Used by admin panel."""
        db = get_db()
        if query:
            # Case-insensitive partial match on name or email
            filter_query = {
                "$or": [
                    {"name": {"$regex": query, "$options": "i"}},
                    {"email": {"$regex": query, "$options": "i"}},
                ]
            }
        else:
            filter_query = {}
        
        users = db[cls.collectionName].find(
            filter_query
        ).sort("createdDate", -1).limit(limit)
        
        return [cls._serializeUser(cls._decryptUser(u)) for u in users]

    @classmethod
    def _getAllUsers(cls, limit: int = 100):
        """Get all users (admin listing)."""
        db = get_db()
        users = db[cls.collectionName].find().sort("createdDate", -1).limit(limit)
        return [cls._serializeUser(cls._decryptUser(u)) for u in users]

    @classmethod
    def _addCredits(cls, email: str, amount: int):
        """Add credits to a user."""
        db = get_db()
        result = db[cls.collectionName].update_one(
            {"email": email},
            {"$inc": {"credits": amount}}
        )
        return result.modified_count > 0

    @classmethod
    def _deductCredits(cls, email: str, amount: int, details: dict = None):
        """Deduct credits from a user if they have enough, and record a transaction."""
        db = get_db()
        result = db[cls.collectionName].update_one(
            {"email": email, "credits": {"$gte": amount}},
            {"$inc": {"credits": -amount}}
        )
        success = result.modified_count > 0
        if success:
            try:
                tx_record = {
                    "userId": email,
                    "type": "deduction",
                    "amount": amount,
                    "createdAt": datetime.now(timezone.utc),
                    "details": details or {}
                }
                db["transactions"].insert_one(tx_record)
            except Exception as e:
                # Log transaction insertion failures, but don't crash the main deduction success flow
                import logging
                logging.getLogger(__name__).error(f"Failed to record transaction for {email}: {e}")
        return success