# src/controllers/authController.py

import logging
import uuid

import os
from datetime import datetime, timedelta, timezone
from typing import List, Dict, Any, Optional, Literal

import bcrypt
from fastapi import APIRouter, HTTPException, Request, Header, Depends, status
from pydantic import BaseModel, Field, model_validator, field_validator
from google.oauth2 import id_token
from google_auth_oauthlib.flow import Flow
from google.auth.transport import requests
import requests as python_requests
from jose import JWTError, jwt

from fastapp.models.userModel import UserModel
from fastapp.utils.utils import generateHash
from fastapp.utils.jwtUtils import decodeJwtToken

logger = logging.getLogger(__name__)

def get_config():
    """Returns a dictionary of configuration variables, cleaned in-memory."""
    def clean(val):
        if val is None: return val
        if isinstance(val, str):
            return val.strip('"').strip("'")
        return val

    # Fetch and clean variables
    google_client_id = clean(os.getenv("GOOGLE_CLIENT_ID"))
    google_client_secret = clean(os.getenv("GOOGLE_CLIENT_SECRET"))
    google_redirect_uri = clean(os.getenv("GOOGLE_REDIRECT_URI"))
    jwt_secret_key = clean(os.getenv("JWT_SECRET_KEY"))
    algorithm = clean(os.getenv("ALGORITHM", "HS256"))
    admin_user = clean(os.getenv("ADMIN_USER", ""))
    
    # Handle ACCESS_TOKEN_EXPIRE_MINUTES
    raw_expire = os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "10080")
    try:
        expire_minutes = int(clean(raw_expire))
    except (ValueError, TypeError):
        expire_minutes = 10080

    return {
        "GOOGLE_CLIENT_ID": google_client_id,
        "GOOGLE_CLIENT_SECRET": google_client_secret,
        "GOOGLE_REDIRECT_URI": google_redirect_uri,
        "JWT_SECRET_KEY": jwt_secret_key,
        "ALGORITHM": algorithm,
        "ACCESS_TOKEN_EXPIRE_MINUTES": expire_minutes,
        "ADMIN_USER": admin_user
    }

# --- Pydantic Models ---
# Model for the incoming request body
class GoogleTokenRequest(BaseModel):
    google_token: str = Field(..., description="The ID token received from Google Sign-In")

class RegisterRequest(BaseModel):
    email: str
    password: str = Field(..., min_length=8, description="At least 8 characters")
    name: Optional[str] = None

    @field_validator("email")
    @classmethod
    def _lower_email(cls, v: str) -> str:
        v = v.strip().lower()
        if "@" not in v or "." not in v.split("@")[-1]:
            raise ValueError("not a valid email address")
        return v

class LoginRequest(BaseModel):
    email: str
    password: str

    @field_validator("email")
    @classmethod
    def _lower_email(cls, v: str) -> str:
        return v.strip().lower()

# --- Create an APIRouter instance ---
authRouter = APIRouter()

# --- Password hashing (local auth provider — no Google account required) ---
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except (ValueError, TypeError):
        return False

# --- Helper Functions ---
def create_access_token(data: dict, expires_delta: timedelta | None = None):
    """Creates a new JWT access token."""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        # Default to 15 minutes if no delta is provided
        expire = datetime.now(timezone.utc) + timedelta(minutes=15)
    
    config = get_config()
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, config["JWT_SECRET_KEY"], algorithm=config["ALGORITHM"])
    return encoded_jwt

async def get_current_user(request: Request):

    authorization = request.headers.get("Authorization")

    if not authorization or not authorization.startswith('Bearer '):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Bearer token missing or invalid."
        )
    token = authorization.split(' ')[1]

    # Ensure get_db() used by blacklist model works here
    payload = decodeJwtToken(token)

    if not payload or 'email' not in payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid, expired, or blacklisted token."
        )

    # Add original token to payload for easy access in the endpoint
    payload['_token'] = token
    return payload

@authRouter.get("/config", summary="Which auth providers are configured")
async def get_auth_config():
    """
    Tells the frontend which sign-in methods are actually usable. Local
    email/password is always available — it's this build's default and needs
    no external account. Google only appears once GOOGLE_CLIENT_ID is set.
    """
    config = get_config()
    return {"local": True, "google": bool(config["GOOGLE_CLIENT_ID"])}

def _role_for(email: str) -> str:
    from fastapp.utils.adminAuth import ADMIN_EMAILS
    return "admin" if email in ADMIN_EMAILS else "user"

def _issue_token_response(email: str) -> Dict[str, Any]:
    config = get_config()
    role = _role_for(email)
    access_token = create_access_token(
        data={"sub": email, "email": email, "role": role},
        expires_delta=timedelta(minutes=config["ACCESS_TOKEN_EXPIRE_MINUTES"]),
    )
    return {"access_token": access_token, "token_type": "bearer", "email": email, "role": role}

@authRouter.post("/register", summary="Create a local account (email + password)", response_model=Dict[str, Any])
async def register_local_user(req: RegisterRequest):
    """
    The default sign-up path for this build — no Google Cloud OAuth app to
    register, no consent screen to configure. Creates the account and logs
    the caller straight in.
    """
    if UserModel._getUserByEmail(req.email):
        raise HTTPException(status_code=409, detail="An account with this email already exists. Try logging in instead.")

    UserModel._createUser(
        hash=generateHash(),
        email=req.email,
        name=req.name or req.email.split("@")[0],
        avatar=f"https://ui-avatars.com/api/?name={req.name or req.email}&background=0D8ABC&color=fff",
        authProviders=[{"provider": "credentials", "providerUserId": req.email}],
        passwordHash=hash_password(req.password),
    )
    return _issue_token_response(req.email)

@authRouter.post("/login", summary="Log in with email + password", response_model=Dict[str, Any])
async def login_local_user(req: LoginRequest):
    user = UserModel._getUserByEmailForAuth(req.email)
    if not user or not user.get("passwordHash"):
        raise HTTPException(status_code=401, detail="No local account with this email. Sign up first, or use Google sign-in if you registered that way.")
    if not verify_password(req.password, user["passwordHash"]):
        raise HTTPException(status_code=401, detail="Incorrect password.")
    return _issue_token_response(req.email)

@authRouter.get("/me", summary="Get current user profile")
async def get_me(auth_payload: dict = Depends(get_current_user)):
    """Returns the currently authenticated user's profile and credits."""
    email = auth_payload.get("email")
    user = UserModel._getUserByEmail(email)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Secure role propagation back to the client profile payload
    from fastapp.utils.adminAuth import ADMIN_EMAILS
    user["role"] = "admin" if email in ADMIN_EMAILS else "user"
    return {"user": user}

@authRouter.post("/token", summary="Exchange Google ID token for application JWT", response_model=Dict[str, Any])
async def exchange_google_token_for_jwt(
    request: Request,
    token_request: GoogleTokenRequest
):
    """
    Receives a Google ID token, verifies it, and returns a new internal JWT.
    This is the primary authentication endpoint for the frontend.
    """
    google_token = token_request.google_token

    config = get_config()
    try:
        # 0. Preliminary DB Connection Check
        # This confirms if the LIVE server actually has access to the DB
        try:
            db = UserModel.get_db() if hasattr(UserModel, 'get_db') else None
            if not db:
                from fastapp.database import get_db
                db = get_db()
            db.command('ping')
        except Exception as db_err:
            logger.error(f"Database connection check failed in auth endpoint: {db_err}")
            raise HTTPException(
                status_code=500,
                detail=f"Backend Database Error: {db_err}. Please ensure MongoDB is reachable and your credentials are correct."
            )

        # 1. Verify the Google ID token with clock skew tolerance
        if not google_token:
            raise HTTPException(status_code=400, detail="Google token is missing")

        idinfo = id_token.verify_oauth2_token(
            google_token, 
            requests.Request(), 
            config["GOOGLE_CLIENT_ID"],
            clock_skew_in_seconds=10
        )

        # 2. Extract user information from the verified token
        user_id = idinfo.get("sub")
        user_email = idinfo.get("email")
        user_name = idinfo.get("name")
        avatar= idinfo.get("picture")

        if not user_id or not user_email:
            raise HTTPException(
                status_code=400,
                detail="User ID or email not found in Google token.",
            )

        existed = UserModel._getUserByEmail(user_email)

        if not existed:
            UserModel._createUser(
                hash=generateHash(),
                email=user_email,
                name=user_name,
                avatar=avatar,
                authProviders=[{
                    "provider": "google",
                    "providerUserId": user_id
                }]
            )
        else:
            UserModel._addAuthProvider(
                email=user_email,
                provider="google",
                providerUserId=user_id
            )

        # 3. Determine user role
        user_role = _role_for(user_email)

        # 4. Create a new JWT for our application
        access_token_expires = timedelta(minutes=config["ACCESS_TOKEN_EXPIRE_MINUTES"])
        
        access_token = create_access_token(
            data={
                "sub": user_email, 
                "google_id": user_id,
                "email": user_email,
                "role": user_role
            },
            expires_delta=access_token_expires,
        )

        return {
            "access_token": access_token,
            "token_type": "bearer",
            "sub": user_email, 
            "google_id": user_id,
            "email": user_email,
            "role": user_role
        }
    
    except ValueError as e:
        logger.error(f"Google token validation failed: {e}")
        raise HTTPException(
            status_code=401,
            detail=f"Invalid Google token: {e}",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except Exception as e:
        logger.error(f"Unexpected authentication error: {e}", exc_info=True)
        # Include exception type and message for better remote debugging
        error_type = type(e).__name__
        raise HTTPException(
            status_code=500,
            detail=f"An unexpected backend error occurred ({error_type}): {str(e)}"
        )

@authRouter.get("/verify-token", summary="Verify if the current token is valid", status_code=status.HTTP_200_OK)
async def verify_user_token(auth_payload: dict = Depends(get_current_user)):
    """
    Verifies the validity of the Bearer token in the Authorization header.
    
    If the token is valid (not expired, correct signature), this endpoint returns 200 OK 
    with user details.
    
    If the token is invalid or expired, the `get_current_user` dependency will automatically 
    raise a 401 Unauthorized exception before this function body is executed.
    """
    return {
        "valid": True,
        "email": auth_payload.get('email'),
        "message": "Token is valid."
    }

@authRouter.get("/refresh-token", summary="refresh hwt token for a new token", response_model=Dict[str, Any])
async def refresh_new_user_token(
    request: Request,
    auth_payload: dict = Depends(get_current_user)
):
    user_email = auth_payload['email']
    user_role = auth_payload.get('role', 'user')
    
    config = get_config()

    #. Create a new JWT for our application
    access_token_expires = timedelta(minutes=config["ACCESS_TOKEN_EXPIRE_MINUTES"])
    access_token = create_access_token(
        data={
            "sub": user_email, 
            "email": user_email,
            "role": user_role
        },
        expires_delta=access_token_expires,
    )

    return { "access_token": access_token }