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
        authProviders: Optional[List[Dict]] = None,
        passwordHash: Optional[str] = None,
    ):
        """Create a new user document. passwordHash is set only for local
        (email/password) sign-ups — Google-only users never get one."""
        currentTime = datetime.now(timezone.utc)
        user = {
            "hash": hash,
            "email": email,
            "name": name,
            "avatar": avatar,
            "credits": 150,  # vestigial — this OSS build has no billing/credit gating (BYOK)
            "authProviders": authProviders if authProviders is not None else [],
            "createdDate": currentTime,
            "updatedDate": currentTime
        }
        if passwordHash:
            user["passwordHash"] = passwordHash

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
        """Retrieve a user by its email. Never includes passwordHash — this is
        the general-purpose lookup used anywhere a user doc might reach the
        API response (e.g. GET /auth/me). For password verification, use
        _getUserByEmailForAuth instead."""
        db = get_db()
        user = db[cls.collectionName].find_one({"email": email})
        if not user:
            return None
        return cls._serializeUser(cls._decryptUser(user))

    @classmethod
    def _getUserByEmailForAuth(cls, email: str):
        """Like _getUserByEmail, but keeps passwordHash. Only call this from
        the login code path that verifies it — never return the result
        directly from an API endpoint."""
        db = get_db()
        user = db[cls.collectionName].find_one({"email": email})
        if not user:
            return None
        user = cls._decryptUser(user)
        user['_id'] = str(user['_id'])
        return user

    @classmethod
    def _serializeUser(cls, user: Dict) -> Dict:
        """Serialize a document by decrypting sensitive fields. Strips
        passwordHash unconditionally — this is the path every public-facing
        lookup goes through, so a password hash can never leak into an API
        response by accident."""
        if not user:
            return None
        user['_id'] = str(user['_id'])
        user.pop('passwordHash', None)
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
        """
        No-op in this OSS build: there is no billing/credit system here — every
        agent uses a credential the developer supplies themselves (BYOK), and GCP
        compute cost is the operator's own cloud bill, not something this platform
        meters or gates on. Always succeeds so every call site that still checks
        the return value (kept for compatibility with the private/hosted build
        this was forked from) never blocks.
        """
        return True