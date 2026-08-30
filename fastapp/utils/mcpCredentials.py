import json
import re
from typing import Any, Dict, Optional

_CRED_PLACEHOLDER_RE = re.compile(r"\$\{cred:([a-zA-Z0-9_]+)\}")


def _lookup_credential_token(instance: Dict[str, Any], cred_key: str) -> Optional[str]:
    """Resolves the ${cred:<cred_key>} placeholder against the credential bound via
    instance.toolConnections[cred_key].credentialId (the same binding set by the
    tools/*/connect endpoints in fleetController.py)."""
    from fastapp.models.credentialModel import CredentialModel

    tool_connections = instance.get("toolConnections") or {}
    cred_id = (tool_connections.get(cred_key) or {}).get("credentialId")
    if not cred_id:
        return None

    creds_doc = CredentialModel.get_by_id(cred_id)
    if not creds_doc:
        return None

    try:
        decrypted = creds_doc.get("decrypted_data") or CredentialModel.decrypt_data(creds_doc["data"])
        creds_json = json.loads(decrypted)
    except (TypeError, ValueError):
        return None

    if not isinstance(creds_json, dict):
        return None

    return creds_json.get("access_token") or creds_json.get("accessToken") or creds_json.get("apiKey")


def resolve_mcp_config_secrets(instance: Dict[str, Any], mcp_config_str: str) -> str:
    """Substitutes ${cred:<key>} placeholders in an mcpConfig JSON string with decrypted
    credential values. Only for transient use (e.g. right before an SSH push) - the result
    must never be persisted to Mongo or returned to the frontend."""
    if not mcp_config_str or "${cred:" not in mcp_config_str:
        return mcp_config_str

    try:
        config = json.loads(mcp_config_str)
    except (TypeError, ValueError):
        return mcp_config_str

    resolved_cache: Dict[str, Optional[str]] = {}

    def resolve_token(cred_key: str) -> Optional[str]:
        if cred_key not in resolved_cache:
            resolved_cache[cred_key] = _lookup_credential_token(instance, cred_key)
        return resolved_cache[cred_key]

    def substitute(value):
        if isinstance(value, str):
            def repl(match):
                token = resolve_token(match.group(1))
                return token if token is not None else match.group(0)
            return _CRED_PLACEHOLDER_RE.sub(repl, value)
        if isinstance(value, dict):
            return {k: substitute(v) for k, v in value.items()}
        if isinstance(value, list):
            return [substitute(v) for v in value]
        return value

    return json.dumps(substitute(config))


def mask_mcp_config_secrets(instance: Dict[str, Any], mcp_config_str: str) -> str:
    """Reverses resolve_mcp_config_secrets: replaces any literal bound-credential token
    value found in a live-VM-read mcpConfig string back with its ${cred:<key>} placeholder,
    so a live SSH read never leaks a resolved secret into Mongo or the frontend."""
    if not mcp_config_str:
        return mcp_config_str

    masked = mcp_config_str
    for cred_key in (instance.get("toolConnections") or {}).keys():
        token = _lookup_credential_token(instance, cred_key)
        if token:
            masked = masked.replace(token, f"${{cred:{cred_key}}}")
    return masked
