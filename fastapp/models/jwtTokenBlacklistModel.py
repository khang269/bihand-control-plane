"""
JWT Token Blacklist Model — tracks invalidated tokens.
Simple implementation for token revocation.
"""

from fastapp.database import get_db
from datetime import datetime, timezone


class JWTTokenBlacklistModel:

    collectionName = "jwtBlacklist"

    @classmethod
    def blacklistToken(cls, token: str, expiresAt: datetime):
        """Add a token to the blacklist."""
        db = get_db()
        db[cls.collectionName].insert_one({
            "token": token,
            "expiresAt": expiresAt,
            "createdAt": datetime.now(timezone.utc),
        })

    @classmethod
    def isBlacklisted(cls, token: str) -> bool:
        """Check if a token has been blacklisted."""
        db = get_db()
        result = db[cls.collectionName].find_one({"token": token})
        return result is not None

    @classmethod
    def cleanupExpired(cls):
        """Remove expired tokens from the blacklist."""
        db = get_db()
        db[cls.collectionName].delete_many({
            "expiresAt": {"$lt": datetime.now(timezone.utc)}
        })
