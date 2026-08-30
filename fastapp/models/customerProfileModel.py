from datetime import datetime, timezone, timedelta
import uuid
from typing import Any, Dict, List, Optional
from fastapp.database import get_db

class CustomerProfileModel:
    @staticmethod
    def _collection():
        return get_db()["customerProfiles"]

    @staticmethod
    def _ensureIndexes():
        CustomerProfileModel._collection().create_index(
            [("fleetId", 1), ("platform", 1), ("externalCustomerId", 1)], unique=True
        )

    @staticmethod
    def _getOrCreate(fleet_id: str, platform: str, external_customer_id: str, display_name: Optional[str] = None) -> Dict:
        """Look up the long-lived customer identity for (fleet, platform, externalCustomerId),
        creating it on first contact. Survives across conversations - this is where tags
        (VIP/B2B/spam), lifetime counters, and the rolling CRM summary live."""
        existing = CustomerProfileModel._collection().find_one({
            "fleetId": fleet_id,
            "platform": platform,
            "externalCustomerId": external_customer_id,
        })
        if existing:
            return existing

        doc = {
            "_id": str(uuid.uuid4()),
            "fleetId": fleet_id,
            "platform": platform,
            "externalCustomerId": external_customer_id,
            "displayName": display_name,
            "tags": [],  # e.g. VIP, B2B, spam
            "optedOut": False,
            # Structured, length-capped fields only - never a free-form appended summary.
            # A model that free-writes this field turns a single successful prompt
            # injection into a persistent backdoor re-injected on every future turn.
            "profileFields": {
                "stage": None,
                "budget": None,
                "interests": [],
                "blockers": None,
            },
            "messagesToday": 0,
            "messagesThisWeek": 0,
            "lastCounterResetAt": datetime.now(timezone.utc),
            "lastEngagedAt": None,
            "createdAt": datetime.now(timezone.utc),
            "updatedAt": datetime.now(timezone.utc),
        }
        try:
            CustomerProfileModel._collection().insert_one(doc)
        except Exception:
            # Lost a race with a concurrent webhook delivery for the same customer - the
            # unique index means the other insert won, just read it back.
            existing = CustomerProfileModel._collection().find_one({
                "fleetId": fleet_id, "platform": platform, "externalCustomerId": external_customer_id,
            })
            if existing:
                return existing
            raise
        return doc

    @staticmethod
    def _getById(profile_id: str) -> Optional[Dict]:
        return CustomerProfileModel._collection().find_one({"_id": profile_id})

    @staticmethod
    def _incrementCounters(profile_id: str) -> None:
        """Increment message counters, resetting the daily counter if a day has rolled over.
        Weekly counter reset is left to a periodic sweep (not implemented in Phase 1) - the
        policy gate should treat these as advisory, not perfectly precise, rate signals."""
        profile = CustomerProfileModel._getById(profile_id)
        if not profile:
            return
        now = datetime.now(timezone.utc)
        last_reset = profile.get("lastCounterResetAt") or now
        if last_reset.tzinfo is None:
            last_reset = last_reset.replace(tzinfo=timezone.utc)

        update: Dict[str, Any] = {"$set": {"lastEngagedAt": now, "updatedAt": now}}
        if now - last_reset > timedelta(days=1):
            update["$set"]["messagesToday"] = 1
            update["$set"]["lastCounterResetAt"] = now
            update["$inc"] = {"messagesThisWeek": 1}
        else:
            update["$inc"] = {"messagesToday": 1, "messagesThisWeek": 1}

        CustomerProfileModel._collection().update_one({"_id": profile_id}, update)

    @staticmethod
    def _setTag(profile_id: str, tag: str) -> None:
        CustomerProfileModel._collection().update_one(
            {"_id": profile_id},
            {"$addToSet": {"tags": tag}, "$set": {"updatedAt": datetime.now(timezone.utc)}}
        )

    @staticmethod
    def _removeTag(profile_id: str, tag: str) -> None:
        CustomerProfileModel._collection().update_one(
            {"_id": profile_id},
            {"$pull": {"tags": tag}, "$set": {"updatedAt": datetime.now(timezone.utc)}}
        )

    @staticmethod
    def _setOptedOut(profile_id: str, opted_out: bool = True) -> None:
        CustomerProfileModel._collection().update_one(
            {"_id": profile_id},
            {"$set": {"optedOut": opted_out, "updatedAt": datetime.now(timezone.utc)}}
        )

    @staticmethod
    def _updateProfileFields(profile_id: str, fields: Dict[str, Any]) -> None:
        """Merge validated, structured fields (stage/budget/interests/blockers) into the
        profile - never accept arbitrary keys or free-text prose here."""
        allowed_keys = {"stage", "budget", "interests", "blockers"}
        sanitized = {f"profileFields.{k}": v for k, v in fields.items() if k in allowed_keys}
        if not sanitized:
            return
        sanitized["updatedAt"] = datetime.now(timezone.utc)
        CustomerProfileModel._collection().update_one({"_id": profile_id}, {"$set": sanitized})

    @staticmethod
    def _listByFleet(fleet_id: str) -> List[Dict]:
        return list(CustomerProfileModel._collection().find({"fleetId": fleet_id}).sort("lastEngagedAt", -1))
