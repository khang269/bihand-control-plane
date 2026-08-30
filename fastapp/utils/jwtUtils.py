import jwt
from datetime import datetime, timedelta, timezone
import os
from dotenv import load_dotenv
from fastapp.models.jwtTokenBlacklistModel import JWTTokenBlacklistModel

load_dotenv(override=True)
JWT_SECRET_KEY = os.environ.get("JWT_SECRET_KEY")

def generateJwtToken(userId, email, role="USER", expiry=None):
    """Generate JWT token with optional role and expiry"""
    exp = datetime.utcnow() + (expiry if expiry else timedelta(days=7))  # Changed to 7 days default
    
    payload = {
        'sub': userId,
        'email': email,
        'role': role,
        'exp': exp,
        'iat': datetime.utcnow()  # Add issued at time
    }
    
    return jwt.encode(
        payload,
        JWT_SECRET_KEY,
        algorithm='HS256'
    )

def generateJwtTokenWithPayload(payload, expiry=None):
    """Generate JWT token with optional role and expiry"""
    exp = datetime.utcnow() + (expiry if expiry else timedelta(days=7))  # Changed to 7 days default
    
    return jwt.encode(
        payload,
        JWT_SECRET_KEY,
        algorithm='HS256'
    )

def decodeJwtToken(token):
    try:
        # if JWTTokenBlacklistModel.isBlacklisted(token):
        #     return None
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=['HS256'])
        return payload
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None
    
def decodeJwtTokenWithBlacklisted(token):
    try:
        if JWTTokenBlacklistModel.isBlacklisted(token):
            return None
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=['HS256'])
        expiration_timestamp = payload['exp']

        # Convert Unix timestamp to a Python datetime object (UTC)
        # MongoDB stores dates in UTC by default and PyMongo handles this well.
        expire_at_datetime = datetime.fromtimestamp(expiration_timestamp, tz=timezone.utc)
        JWTTokenBlacklistModel.blacklistToken(token=token, expiresAt=expire_at_datetime)
        return payload
    except jwt.ExpiredSignatureError as e:
        print(f"Token expired: {str(e)}")
        return None
    except jwt.InvalidTokenError as e:
        print(f"Invalid token: {str(e)}")
        return None

def refreshJwtToken(token):
    """Refresh an existing JWT token"""
    try:
        # Decode current token
        current_payload = jwt.decode(
            token, 
            JWT_SECRET_KEY, 
            algorithms=['HS256']
        )
        
        # Generate new token with same user data but new expiry
        return generateJwtToken(
            userId=current_payload['sub'],
            email=current_payload['email'],
            role=current_payload['role']
        )
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        return None