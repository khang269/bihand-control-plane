"""
Admin authentication dependency for FastAPI routes.
Checks that the current user has admin role.
"""

import os
from fastapi import Depends, HTTPException, status
from fastapp.controllers.authController import get_current_user

ADMIN_USER = os.getenv("ADMIN_USER", "")

# Admin allowlist is entirely operator-configured — set ADMIN_USER (comma-separated
# emails) in your own .env. No maintainer email ships as a default admin here.
ADMIN_EMAILS = [e.strip() for e in ADMIN_USER.split(",") if e.strip()]


async def require_admin(auth_payload: dict = Depends(get_current_user)):
    """
    FastAPI dependency that ensures the current user is an admin.
    Use as: admin = Depends(require_admin)
    """
    email = auth_payload.get("email", "")
    role = auth_payload.get("role", "user")
    
    if role != "admin" and email not in ADMIN_EMAILS:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return auth_payload
