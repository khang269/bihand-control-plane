"""Thin API client — the job's only channel back to the server."""

from __future__ import annotations

import os
from typing import Any, Dict, Optional

import requests


class BudgetExhausted(RuntimeError):
    """The task's credit budget (or the user's balance) ran out mid-run."""


class ApiClient:
    def __init__(self) -> None:
        self.base = os.environ["API_BASE"].rstrip("/")
        self.key = os.environ["SANDBOX_KEY"]
        self.task_id = os.environ["TASK_ID"]
        self._s = requests.Session()
        self._s.headers.update({"X-Sandbox-Key": self.key, "Content-Type": "application/json"})

    def generate_json(self, instruction: str, schema: Dict[str, Any],
                      purpose: str = "", retries: int = 3) -> Dict[str, Any]:
        """Structured generation via the server proxy. The server meters and bills."""
        last = None
        for attempt in range(retries):
            try:
                r = self._s.post(f"{self.base}/api/internal/sandbox/llm",
                                 json={"instruction": instruction, "schema": schema, "purpose": purpose},
                                 timeout=180)
                if r.status_code == 402:
                    raise BudgetExhausted(r.json().get("detail", "credit budget exhausted"))
                if r.status_code == 401:
                    raise RuntimeError("sandbox key rejected")
                r.raise_for_status()
                body = r.json()
                parsed = body.get("parsed")
                if isinstance(parsed, dict) and parsed:
                    return parsed
                return _loads_first_object(body.get("text") or "")
            except BudgetExhausted:
                raise
            except Exception as exc:  # noqa: BLE001 — retry transient upstream errors
                last = exc
        raise RuntimeError(f"LLM call failed after {retries} attempts: {last}")

    def chat(self, messages: list, tools: Optional[list] = None, retries: int = 3) -> Dict[str, Any]:
        """One tool-calling turn of the ReAct loop. The server relays OpenAI-format
        messages/tools to the LiteLLM proxy (which owns the Gemini translation),
        meters tokens, and returns {content, toolCalls, rawMessage, usage}. Append
        `rawMessage` back as the assistant turn to preserve provider fields."""
        last = None
        for _ in range(retries):
            try:
                r = self._s.post(f"{self.base}/api/internal/sandbox/chat",
                                 json={"messages": messages, "tools": tools or []}, timeout=180)
                if r.status_code == 402:
                    raise BudgetExhausted(r.json().get("detail", "credit budget exhausted"))
                if r.status_code == 401:
                    raise RuntimeError("sandbox key rejected")
                r.raise_for_status()
                return r.json()
            except BudgetExhausted:
                raise
            except Exception as exc:  # noqa: BLE001 — retry transient upstream errors
                last = exc
        raise RuntimeError(f"chat call failed after {retries} attempts: {last}")

    def get_context(self) -> list:
        """Prior turns in this task's session (for follow-up continuity)."""
        try:
            r = self._s.get(f"{self.base}/api/internal/sandbox/context", timeout=20)
            r.raise_for_status()
            return r.json().get("turns", [])
        except Exception:
            return []

    def progress(self, name: str, status: str = "running", detail: str = "") -> None:
        try:
            self._s.post(f"{self.base}/api/internal/sandbox/progress",
                         json={"name": name, "status": status, "detail": detail}, timeout=15)
        except Exception:
            pass  # progress is cosmetic; never fail a run over it

    def submit(self, payload: Dict[str, Any]) -> None:
        r = self._s.post(f"{self.base}/api/internal/sandbox/result", json=payload, timeout=60)
        r.raise_for_status()


def _loads_first_object(text: str) -> Dict[str, Any]:
    """Tolerant JSON extraction: fences stripped, trailing tokens ignored."""
    import json

    s = (text or "").strip()
    if s.startswith("```"):
        s = s.strip("`")
        if s.lower().startswith("json"):
            s = s[4:]
    i = s.find("{")
    if i == -1:
        raise ValueError("model response contained no JSON object")
    obj, _ = json.JSONDecoder().raw_decode(s[i:])
    if not isinstance(obj, dict):
        raise ValueError("model response was not a JSON object")
    return obj
