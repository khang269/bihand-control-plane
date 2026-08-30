from fastapi import APIRouter, Depends, HTTPException, Body
from pydantic import BaseModel, Field
from typing import List, Optional
from fastapp.controllers.authController import get_current_user
from fastapp.models.credentialModel import CredentialModel

credentialRouter = APIRouter()

class CredentialCreateReq(BaseModel):
    name: str = Field(..., description="Name of the credential")
    type: str = Field(..., description="Type of credential (e.g. llm_api_key)")
    data: str = Field(..., description="The raw secret data to encrypt")

class CredentialUpdateReq(BaseModel):
    name: str = Field(..., description="Name of the credential")
    data: Optional[str] = Field(None, description="The raw secret data to encrypt (leave blank to not update)")

@credentialRouter.post("", summary="Create a new credential")
async def create_credential(req: CredentialCreateReq, auth_payload: dict = Depends(get_current_user)):
    email = auth_payload["email"]
    doc = CredentialModel.create(user_id=email, name=req.name, cred_type=req.type, data=req.data)
    doc["data"] = "***"
    return {"message": "Credential created", "credential": doc}

@credentialRouter.get("", summary="List user credentials")
async def list_credentials(auth_payload: dict = Depends(get_current_user)):
    email = auth_payload["email"]
    creds = CredentialModel.list_by_user(user_id=email)
    return {"credentials": creds}

@credentialRouter.put("/{cred_id}", summary="Update a credential")
async def update_credential(cred_id: str, req: CredentialUpdateReq, auth_payload: dict = Depends(get_current_user)):
    email = auth_payload["email"]
    success = CredentialModel.update(cred_id=cred_id, user_id=email, name=req.name, data=req.data)
    if not success:
        raise HTTPException(status_code=404, detail="Credential not found")
    return {"message": "Credential updated"}

@credentialRouter.delete("/{cred_id}", summary="Delete a credential")
async def delete_credential(cred_id: str, auth_payload: dict = Depends(get_current_user)):
    email = auth_payload["email"]
    success = CredentialModel.delete(cred_id=cred_id, user_id=email)
    if not success:
        raise HTTPException(status_code=404, detail="Credential not found")
    return {"message": "Credential deleted"}

class KeyValidationRequest(BaseModel):
    provider: str
    apiKey: Optional[str] = None
    credentialId: Optional[str] = None
    onBehalfOf: Optional[str] = None


@credentialRouter.post("/validate", summary="Validate LLM API Key and get popular models")
async def validate_api_key_route(req: KeyValidationRequest, auth_payload: dict = Depends(get_current_user)):
    """
    Validate an LLM API key before creating a credential or deploying a fleet.
    Supports validating raw keys or a previously saved credential ID.
    Available to all authenticated users.
    """
    from fastapp.services import validatorService
    from fastapp.controllers.adminController import ADMIN_EMAILS
    
    email = auth_payload["email"]
    api_key_to_test = req.apiKey

    if req.credentialId:
        # Load from saved credentials
        creds_doc = CredentialModel.get_by_id(req.credentialId)
        if not creds_doc:
            raise HTTPException(status_code=404, detail="Credential not found")
            
        # Secure backdoor delegation bypass: if the current user is an admin and validating on behalf of another user
        owner_email = creds_doc.get("userId")
        if owner_email != email:
            if email in ADMIN_EMAILS and req.onBehalfOf == owner_email:
                # Allowed admin inspection bypass
                pass
            else:
                raise HTTPException(status_code=403, detail="Unauthorized access to credential")
                
        api_key_to_test = creds_doc.get("decrypted_data")

    if not api_key_to_test:
        raise HTTPException(status_code=400, detail="Missing API Key or Credential ID")

    is_valid, error = await validatorService.validate_key(req.provider, api_key_to_test)
    if not is_valid:
        return {
            "valid": False,
            "error": error,
            "models": []
        }
    
    # Return valid status plus the curated model options
    models = validatorService.get_popular_models(req.provider)
    return {
        "valid": True,
        "models": models
    }

import os
import secrets
from urllib.parse import urlencode
from datetime import datetime, timezone
import requests
from fastapi.responses import RedirectResponse

DEFAULT_GOOGLE_SCOPES = [
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/documents",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/contacts",
]

def _google_redirect_uri() -> str:
    base_url = os.environ.get("BIHAND_PUBLIC_API_URL", "http://localhost:8501").rstrip("/")
    return f"{base_url}/api/credentials/oauth/google/callback"

def _public_web_url() -> str:
    # Use the public API url but with frontend port if SaaS, or simply base it on BIHAND_WEB_URL / public url
    public_api = os.environ.get("BIHAND_PUBLIC_API_URL")
    if public_api:
        return public_api.rstrip("/")
    return os.environ.get("BIHAND_WEB_URL", "http://localhost:3100").rstrip("/")

class StartGoogleOAuthReq(BaseModel):
    name: str = Field(default="Google Workspace", description="Name for the credential")

@credentialRouter.post("/oauth/google/start", summary="Start Google Workspace OAuth")
async def start_google_workspace_oauth(req: StartGoogleOAuthReq, auth_payload: dict = Depends(get_current_user)):
    email = auth_payload["email"]
    client_id = os.environ.get("GOOGLE_CLIENT_ID")
    client_secret = os.environ.get("GOOGLE_CLIENT_SECRET")
    if not client_id or not client_secret:
        raise HTTPException(status_code=500, detail="Google Workspace OAuth is not configured")

    state = secrets.token_urlsafe(24)
    
    # Store pending state in DB
    from fastapp.database import get_db
    get_db()["credentials"].insert_one({
        "_id": state,
        "userId": email,
        "name": req.name,
        "type": "google_workspace",
        "data": "",
        "status": "pending_oauth",
        "createdAt": datetime.now(timezone.utc)
    })

    query = urlencode({
        "client_id": client_id,
        "redirect_uri": _google_redirect_uri(),
        "response_type": "code",
        "scope": " ".join(DEFAULT_GOOGLE_SCOPES),
        "state": state,
        "access_type": "offline",
        "prompt": "consent",
        "include_granted_scopes": "true",
        "login_hint": email,
    })

    auth_url = f"https://accounts.google.com/o/oauth2/v2/auth?{query}"
    return {"authUrl": auth_url, "state": state}

@credentialRouter.get("/oauth/google/callback", include_in_schema=False)
async def google_workspace_callback(state: str, code: Optional[str] = None, error: Optional[str] = None):
    from fastapp.database import get_db
    import json
    
    db = get_db()
    cred = db["credentials"].find_one({"_id": state, "status": "pending_oauth"})
    if not cred:
        raise HTTPException(status_code=400, detail="Invalid OAuth state")

    redirect_base = f"{_public_web_url()}/credentials"

    if error:
        db["credentials"].delete_one({"_id": state})
        return RedirectResponse(url=f"{redirect_base}?error=oauth_rejected")

    if not code:
        raise HTTPException(status_code=400, detail="Missing authorization code")

    client_id = os.environ.get("GOOGLE_CLIENT_ID")
    client_secret = os.environ.get("GOOGLE_CLIENT_SECRET")

    token_resp = requests.post(
        "https://oauth2.googleapis.com/token",
        data={
            "code": code,
            "client_id": client_id,
            "client_secret": client_secret,
            "redirect_uri": _google_redirect_uri(),
            "grant_type": "authorization_code",
        },
        timeout=20,
    )
    if token_resp.status_code >= 400:
        db["credentials"].delete_one({"_id": state})
        return RedirectResponse(url=f"{redirect_base}?error=token_exchange_failed")

    token_json = token_resp.json()
    access_token = token_json.get("access_token", "")
    refresh_token = token_json.get("refresh_token", "")

    user_email = "google_workspace_user"
    if access_token:
        try:
            me_resp = requests.get(
                "https://www.googleapis.com/oauth2/v3/userinfo",
                headers={"Authorization": f"Bearer {access_token}"},
                timeout=10,
            )
            if me_resp.status_code < 400:
                user_email = me_resp.json().get("email")
        except Exception:
            pass

    # Save to CredentialModel securely
    final_data = json.dumps({
        "accessToken": access_token,
        "refreshToken": refresh_token,
        "email": user_email,
        "expiresIn": token_json.get("expires_in")
    })
    
    # We replace the pending document with a real one
    import uuid
    new_id = str(uuid.uuid4())
    db["credentials"].insert_one({
        "_id": new_id,
        "userId": cred["userId"],
        "name": f"Google Workspace ({user_email})",
        "type": "google_workspace",
        "data": CredentialModel.encrypt_data(final_data),
        "status": "active",
        "createdAt": datetime.now(timezone.utc),
        "updatedAt": datetime.now(timezone.utc)
    })
    db["credentials"].delete_one({"_id": state})

    return RedirectResponse(url=f"{redirect_base}?success=google_connected")


def _meta_redirect_uri() -> str:
    base_url = os.environ.get("BIHAND_PUBLIC_API_URL", "http://localhost:8501").rstrip("/")
    return f"{base_url}/api/credentials/oauth/meta/callback"


class StartMetaOAuthReq(BaseModel):
    name: str = Field(default="Meta Developer Tools", description="Name for the credential")


@credentialRouter.post("/oauth/meta/start", summary="Start Meta (Facebook) OAuth for Developer Tools MCP")
async def start_meta_devtools_oauth(req: StartMetaOAuthReq, auth_payload: dict = Depends(get_current_user)):
    email = auth_payload["email"]
    client_id = os.environ.get("META_APP_ID")
    client_secret = os.environ.get("META_APP_SECRET")
    if not client_id or not client_secret:
        raise HTTPException(status_code=500, detail="Meta OAuth is not configured")

    state = secrets.token_urlsafe(24)

    from fastapp.database import get_db
    get_db()["credentials"].insert_one({
        "_id": state,
        "userId": email,
        "name": req.name,
        "type": "meta_devtools",
        "data": "",
        "status": "pending_oauth",
        "createdAt": datetime.now(timezone.utc)
    })

    # Facebook Login for Business rejects the dialog outright ("This app doesn't seem to be
    # active - needs at least one supported permission") if scope is omitted, or contains only
    # public_profile/email - both confirmed live against a real app. Meta's own docs: those two
    # are auto-granted to every app but don't count toward the "at least one supported
    # permission" requirement, so a real additional permission is required. pages_show_list is
    # commonly available at standard access (no App Review) and fits Devtools MCP's own
    # described toolset (webhook subscriptions are Page-scoped). Devtools MCP's own scope
    # requirements are still unverified (its docs page returned HTTP 500 every time this was
    # checked) - adjust here if mcp.facebook.com/devtools itself later rejects this token.
    query = urlencode({
        "client_id": client_id,
        "redirect_uri": _meta_redirect_uri(),
        "response_type": "code",
        "scope": "public_profile,pages_show_list",
        "state": state,
    })

    auth_url = f"https://www.facebook.com/v21.0/dialog/oauth?{query}"
    return {"authUrl": auth_url, "state": state}


@credentialRouter.get("/oauth/meta/callback", include_in_schema=False)
async def meta_devtools_callback(state: str, code: Optional[str] = None, error: Optional[str] = None):
    from fastapp.database import get_db
    import json

    db = get_db()
    cred = db["credentials"].find_one({"_id": state, "status": "pending_oauth"})
    if not cred:
        raise HTTPException(status_code=400, detail="Invalid OAuth state")

    redirect_base = f"{_public_web_url()}/credentials"

    if error:
        db["credentials"].delete_one({"_id": state})
        return RedirectResponse(url=f"{redirect_base}?error=oauth_rejected")

    if not code:
        raise HTTPException(status_code=400, detail="Missing authorization code")

    client_id = os.environ.get("META_APP_ID")
    client_secret = os.environ.get("META_APP_SECRET")

    token_resp = requests.get(
        "https://graph.facebook.com/v21.0/oauth/access_token",
        params={
            "client_id": client_id,
            "redirect_uri": _meta_redirect_uri(),
            "client_secret": client_secret,
            "code": code,
        },
        timeout=20,
    )
    if token_resp.status_code >= 400:
        db["credentials"].delete_one({"_id": state})
        return RedirectResponse(url=f"{redirect_base}?error=token_exchange_failed")

    short_lived_token = token_resp.json().get("access_token", "")

    # Exchange the short-lived user token for a long-lived one (~60 days) - the ${cred:...}
    # placeholder in an agent's MCP config is only resolved once, at SSH-push time, not live
    # per MCP call, so a 1-2hr short-lived token would silently break the connection quickly.
    exchange_resp = requests.get(
        "https://graph.facebook.com/v21.0/oauth/access_token",
        params={
            "grant_type": "fb_exchange_token",
            "client_id": client_id,
            "client_secret": client_secret,
            "fb_exchange_token": short_lived_token,
        },
        timeout=20,
    )
    if exchange_resp.status_code >= 400:
        db["credentials"].delete_one({"_id": state})
        return RedirectResponse(url=f"{redirect_base}?error=token_exchange_failed")

    long_lived_json = exchange_resp.json()
    access_token = long_lived_json.get("access_token", short_lived_token)

    display_name = "Meta Developer Tools User"
    if access_token:
        try:
            me_resp = requests.get(
                "https://graph.facebook.com/me",
                params={"fields": "name", "access_token": access_token},
                timeout=10,
            )
            if me_resp.status_code < 400:
                display_name = me_resp.json().get("name", display_name)
        except Exception:
            pass

    final_data = json.dumps({
        "accessToken": access_token,
        "expiresIn": long_lived_json.get("expires_in"),
        "obtainedAt": datetime.now(timezone.utc).isoformat(),
    })

    import uuid
    new_id = str(uuid.uuid4())
    db["credentials"].insert_one({
        "_id": new_id,
        "userId": cred["userId"],
        "name": f"Meta Developer Tools ({display_name})",
        "type": "meta_devtools",
        "data": CredentialModel.encrypt_data(final_data),
        "status": "active",
        "createdAt": datetime.now(timezone.utc),
        "updatedAt": datetime.now(timezone.utc)
    })
    db["credentials"].delete_one({"_id": state})

    return RedirectResponse(url=f"{redirect_base}?success=meta_devtools_connected")
