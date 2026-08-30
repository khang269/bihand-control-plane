"""
Validator Service — verifies API keys and connectivity for various LLM providers.
Used for pre-provisioning checks to prevent deployment failures.
"""

import logging
import httpx
from typing import Tuple, List

logger = logging.getLogger(__name__)

# Exact model strings from NemoClaw Documentation
POPULAR_MODELS = {
    "google": [
        "gemini-3.5-flash",
        "gemini-3.1-pro-preview",
        "gemini-3.1-flash-lite",
        "gemini-2.5-flash",
        "gemini-2.5-pro"
    ],
    "openai": [
        "gpt-5.4",
        "gpt-5.4-mini", 
        "gpt-5.4-nano", 
        "gpt-5.4-pro-2026-03-05"
    ],
    "anthropic": [
        "claude-sonnet-4-6", 
        "claude-haiku-4-5", 
        "claude-opus-4-6"
    ]
}

async def validate_key(provider: str, api_key: str) -> Tuple[bool, str]:
    """
    Validate an API key by making a lightweight request to the provider's API.
    Returns: (is_valid, error_message)
    """
    if provider == "bihand":
        return True, ""
        
    if not api_key or len(api_key) < 5:
        return False, "API key is too short or missing."

    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            if provider == "google" or provider == "gemini":
                # Gemini validation: List models endpoint
                url = f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}"
                resp = await client.get(url)
                if resp.status_code == 200:
                    return True, ""
                return False, f"Gemini API Error: {resp.text}"

            elif provider == "openai":
                # OpenAI validation: List models
                url = "https://api.openai.com/v1/models"
                headers = {"Authorization": f"Bearer {api_key}"}
                resp = await client.get(url, headers=headers)
                if resp.status_code == 200:
                    return True, ""
                return False, f"OpenAI API Error: {resp.json().get('error', {}).get('message', 'Authentication failed')}"

            elif provider == "anthropic":
                # Anthropic validation: List models (requires version header)
                url = "https://api.anthropic.com/v1/models"
                headers = {
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01"
                }
                resp = await client.get(url, headers=headers)
                if resp.status_code == 200:
                    return True, ""
                return False, f"Anthropic API Error: {resp.json().get('error', {}).get('message', 'Authentication failed')}"

            elif provider == "deepseek":
                # DeepSeek is OpenAI-compatible
                url = "https://api.deepseek.com/v1/models"
                headers = {"Authorization": f"Bearer {api_key}"}
                resp = await client.get(url, headers=headers)
                if resp.status_code == 200:
                    return True, ""
                return False, f"DeepSeek API Error: {resp.json().get('error', {}).get('message', 'Authentication failed')}"

            else:
                return False, f"Unsupported provider: {provider}"

        except Exception as e:
            logger.error(f"Validation exception for {provider}: {str(e)}")
            return False, f"Connection failed: {str(e)}"

def get_popular_models(provider: str) -> List[str]:
    """Return a curated list of models for the given provider."""
    return POPULAR_MODELS.get(provider, [])
