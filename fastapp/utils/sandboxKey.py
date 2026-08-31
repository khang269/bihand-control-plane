"""
Per-task sandbox credentials for the Trading Studio Cloud Run job.

A run gets a random opaque token, handed to the job as an argument. There is no
signing secret: the token *is* the task record, verified by an indexed lookup of
its SHA-256. Only the hash is stored, so a read-only database exposure yields no
usable keys.

Bounds live on the task document itself (expiry, credit budget, status), which
is the same document every LLM callback has to read anyway.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

# Grace beyond the Cloud Run job timeout (600s — terraform/dev/services/
# minerclaw-test/main.tf in the infra repo) so an in-flight call at the
# deadline is not rejected mid-flight.
KEY_TTL_SECONDS = 630
DEFAULT_BUDGET_CREDITS = 200.0


def generate_sandbox_key() -> str:
    """Return a fresh 256-bit opaque token. Never stored in this form."""
    return secrets.token_urlsafe(32)


def hash_sandbox_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def key_expiry() -> datetime:
    return datetime.now(timezone.utc) + timedelta(seconds=KEY_TTL_SECONDS)


def verify_sandbox_key(key: Optional[str]) -> Optional[Dict[str, Any]]:
    """
    Resolve a sandbox token to its task document, or None.

    Rejects: unknown token, expired token, or a task already in a terminal
    state. Budget and user-credit checks are the caller's job, since they differ
    per endpoint.
    """
    if not key or len(key) < 20:
        return None

    from fastapp.database import get_db

    digest = hash_sandbox_key(key)
    task = get_db()["trading_predictions"].find_one({"sandboxKeyHash": digest})
    if not task:
        return None

    # Constant-time compare even though the lookup already matched — keeps the
    # comparison habit correct if this is ever refactored to fetch by taskId.
    if not hmac.compare_digest(task.get("sandboxKeyHash", ""), digest):
        return None

    if task.get("status") in ("COMPLETED", "FAILED"):
        return None

    expires = task.get("sandboxKeyExpiresAt")
    if expires is not None:
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) > expires:
            return None

    return task


def revoke_sandbox_key(task_id: str) -> None:
    """Clear the token so it cannot be reused (single-use `/result`, or on finish)."""
    from fastapp.database import get_db

    get_db()["trading_predictions"].update_one(
        {"_id": task_id}, {"$unset": {"sandboxKeyHash": ""}}
    )
