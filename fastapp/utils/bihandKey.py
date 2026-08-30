import hmac
import hashlib
import os
from typing import Optional

def generate_bihand_api_key(email: str) -> str:
    """
    Generate a stateless, signed, secure API key for the Bihand provider.
    Format: bh_<email_hex>.<signature>
    """
    secret = os.environ.get("JWT_SECRET_KEY", "fallback_secret_for_bihand_keys_12345").encode()
    msg = email.encode()
    signature = hmac.new(secret, msg, hashlib.sha256).hexdigest()
    email_hex = email.encode().hex()
    return f"bh_{email_hex}.{signature}"

def verify_bihand_api_key(key: str) -> Optional[str]:
    """
    Verify a Bihand API key and extract the corresponding user email.
    """
    if not key or not key.startswith("bh_"):
        return None
    try:
        parts = key[3:].split(".")
        if len(parts) != 2:
            return None
        email_hex, signature = parts
        email = bytes.fromhex(email_hex).decode()
        secret = os.environ.get("JWT_SECRET_KEY", "fallback_secret_for_bihand_keys_12345").encode()
        expected_sig = hmac.new(secret, email.encode(), hashlib.sha256).hexdigest()
        if hmac.compare_digest(expected_sig, signature):
            return email
    except Exception:
        pass
    return None
