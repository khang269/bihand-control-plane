"""
Callback surface for the Trading Studio Cloud Run sandbox.

The caller is a container executing LLM-generated code, so every request here is
treated as hostile input. Two endpoints, both authenticated by the per-task
token (never by anything in the request body):

  POST /api/internal/sandbox/llm     structured generation, metered and billed
                                     against the specific trading task
  POST /api/internal/sandbox/result  final artifacts; single-use

Authority always comes from the key. A `taskId` present in a body is ignored.
"""

from __future__ import annotations

import logging
import math
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field

from fastapp.database import get_db
from fastapp.models.userModel import UserModel
from fastapp.utils.sandboxKey import revoke_sandbox_key, verify_sandbox_key

logger = logging.getLogger(__name__)

sandboxRouter = APIRouter(tags=["Trading Studio sandbox callbacks"])

# Same rates the Bihand LLM proxy meters at (llmController): Gemini 3.5 Flash
# $1.50 / 1M input, $9.00 / 1M output.
INPUT_USD_PER_TOKEN = 0.0000015
OUTPUT_USD_PER_TOKEN = 0.000009
CREDITS_PER_USD = 100.0

MAX_INSTRUCTION_CHARS = 200_000
MAX_RESULT_BYTES = 5 * 1024 * 1024
MAX_ARRAY_LEN = 5000
MAX_STRING_LEN = 20_000
MAX_TRADES = 500


# --------------------------------------------------------------------------
# LLM proxy
# --------------------------------------------------------------------------

class SandboxLLMRequest(BaseModel):
    instruction: str = Field(..., max_length=MAX_INSTRUCTION_CHARS)
    schema_: Dict[str, Any] = Field(..., alias="schema")
    purpose: Optional[str] = Field(None, max_length=64)

    class Config:
        populate_by_name = True


def _auth(key: Optional[str]) -> Dict[str, Any]:
    task = verify_sandbox_key(key)
    if not task:
        raise HTTPException(status_code=401, detail="Invalid, expired, or spent sandbox key.")
    return task


@sandboxRouter.post("/sandbox/llm", summary="Structured LLM generation, billed to a trading task")
def sandbox_llm(req: SandboxLLMRequest, x_sandbox_key: Optional[str] = Header(None, alias="X-Sandbox-Key")):
    task = _auth(x_sandbox_key)
    task_id = task["_id"]
    email = task.get("userId")

    # No-billing OSS build (BYOK): no task-budget or user-credit gate here — the
    # `billing` counters below stay only as informational metering, same as the
    # rest of this build's no-op credit system.

    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="Server LLM configuration is missing.")

    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=api_key)
        resp = client.models.generate_content(
            model="gemini-3.5-flash",
            contents=req.instruction,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=req.schema_,
            ),
        )
    except Exception as exc:
        logger.error(f"[sandbox/llm {task_id}] generation failed: {exc}")
        raise HTTPException(status_code=502, detail=f"Upstream model error: {type(exc).__name__}")

    # Meter here, at a boundary the sandbox cannot bypass.
    meta = getattr(resp, "usage_metadata", None)
    in_tok = int(getattr(meta, "prompt_token_count", 0) or 0) if meta else 0
    out_tok = (int(getattr(meta, "candidates_token_count", 0) or 0)
               + int(getattr(meta, "thoughts_token_count", 0) or 0)) if meta else 0
    cost_usd = in_tok * INPUT_USD_PER_TOKEN + out_tok * OUTPUT_USD_PER_TOKEN
    credits = round(cost_usd * CREDITS_PER_USD, 6)

    try:
        UserModel._deductCredits(email, credits, {
            "app": "trading-studio", "feature": "sandbox-llm",
            "taskId": task_id, "purpose": req.purpose,
        })
        get_db()["trading_predictions"].update_one(
            {"_id": task_id},
            {"$inc": {
                "billing.inputTokens": in_tok,
                "billing.outputTokens": out_tok,
                "billing.llmCalls": 1,
                "billing.costUsd": round(cost_usd, 6),
                "billing.chargedCredits": credits,
            },
             "$set": {"updatedAt": datetime.now(timezone.utc)}},
        )
    except Exception as exc:
        logger.error(f"[sandbox/llm {task_id}] billing failed: {exc}")

    parsed = getattr(resp, "parsed", None)
    return {
        "parsed": parsed if isinstance(parsed, dict) else None,
        "text": resp.text or "",
        "usage": {"inputTokens": in_tok, "outputTokens": out_tok, "credits": credits},
    }


# --------------------------------------------------------------------------
# Tool-calling chat proxy (powers the ReAct agent loop in the sandbox)
# --------------------------------------------------------------------------

class SandboxChatRequest(BaseModel):
    # OpenAI-format messages and tools, passed straight through to the LiteLLM
    # proxy (which handles the Gemini function-calling translation, including
    # Gemini-3 thought signatures). We only add task-scoped auth and billing.
    messages: List[Dict[str, Any]] = Field(..., max_length=200)
    tools: Optional[List[Dict[str, Any]]] = Field(None, max_length=40)


def _bill_tokens(task_id: str, email: str, in_tok: int, out_tok: int, purpose: str) -> float:
    """Shared metering: deduct credits and increment the task's billing counters."""
    cost_usd = in_tok * INPUT_USD_PER_TOKEN + out_tok * OUTPUT_USD_PER_TOKEN
    credits = round(cost_usd * CREDITS_PER_USD, 6)
    try:
        UserModel._deductCredits(email, credits, {
            "app": "trading-studio", "feature": "sandbox-chat",
            "taskId": task_id, "purpose": purpose,
        })
        get_db()["trading_predictions"].update_one(
            {"_id": task_id},
            {"$inc": {
                "billing.inputTokens": in_tok, "billing.outputTokens": out_tok,
                "billing.llmCalls": 1, "billing.costUsd": round(cost_usd, 6),
                "billing.chargedCredits": credits,
            },
             "$set": {"updatedAt": datetime.now(timezone.utc)}},
        )
    except Exception as exc:
        logger.error(f"[sandbox/chat {task_id}] billing failed: {exc}")
    return credits


@sandboxRouter.post("/sandbox/chat", summary="Tool-calling chat turn for the ReAct agent, billed to a trading task")
def sandbox_chat(req: SandboxChatRequest, x_sandbox_key: Optional[str] = Header(None, alias="X-Sandbox-Key")):
    task = _auth(x_sandbox_key)
    task_id = task["_id"]
    email = task.get("userId")

    # No-billing OSS build (BYOK): no task-budget or user-credit gate here.

    # Reuse the same central LiteLLM proxy the Bihand LLM provider uses. It speaks
    # OpenAI /v1/chat/completions with native tool calling and owns the Gemini
    # translation, so the sandbox never touches provider-specific message shapes.
    import httpx
    litellm_key = os.environ.get("LITELLM_API_KEY", "sk-1234")
    litellm_url = os.environ.get("LITELLM_PROXY_URL", "http://127.0.0.1:1234").rstrip("/")

    body: Dict[str, Any] = {
        "model": "gemini-3.5-flash",
        "messages": req.messages,
        "temperature": 0.7,
    }
    if req.tools:
        body["tools"] = req.tools
        body["tool_choice"] = "auto"

    try:
        with httpx.Client(timeout=180.0) as client:
            r = client.post(f"{litellm_url}/v1/chat/completions", json=body,
                            headers={"Authorization": f"Bearer {litellm_key}"})
            r.raise_for_status()
            data = r.json()
    except Exception as exc:
        logger.error(f"[sandbox/chat {task_id}] upstream proxy error: {exc}")
        raise HTTPException(status_code=502, detail=f"Upstream model error: {type(exc).__name__}")

    choice = ((data.get("choices") or [{}])[0]) or {}
    message = choice.get("message") or {}
    content = message.get("content") or ""
    # Normalise tool_calls to a compact {id, name, args} shape for the sandbox.
    tool_calls: List[Dict[str, Any]] = []
    for tc in (message.get("tool_calls") or []):
        fn = tc.get("function") or {}
        raw_args = fn.get("arguments")
        if isinstance(raw_args, str):
            try:
                import json as _json
                args = _json.loads(raw_args or "{}")
            except Exception:
                args = {}
        else:
            args = raw_args or {}
        tool_calls.append({"id": tc.get("id"), "name": fn.get("name"), "args": args})

    usage = data.get("usage") or {}
    in_tok = int(usage.get("prompt_tokens", 0) or 0)
    out_tok = int(usage.get("completion_tokens", 0) or 0)
    credits = _bill_tokens(task_id, email, in_tok, out_tok, "react-chat")

    return {
        "content": content,
        "toolCalls": tool_calls,
        "rawMessage": message,  # echoed back verbatim as the assistant turn (preserves provider fields)
        "usage": {"inputTokens": in_tok, "outputTokens": out_tok, "credits": credits},
    }


# --------------------------------------------------------------------------
# Result submission
# --------------------------------------------------------------------------

def _num(v: Any) -> Optional[float]:
    """Coerce to a finite float or None — the payload is attacker-controlled."""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _num_list(v: Any, cap: int = MAX_ARRAY_LEN) -> List[float]:
    if not isinstance(v, list):
        return []
    return [n for n in (_num(x) for x in v[:cap]) if n is not None]


def _text(v: Any, cap: int = MAX_STRING_LEN) -> str:
    return v[:cap] if isinstance(v, str) else ""


def _sanitize_display(v: Any, cap: int = MAX_STRING_LEN) -> str:
    """
    Strip HTML-ish markup from text that will be rendered.

    The UI is already safe (ReactMarkdown without rehype-raw; the code viewer
    escapes < > &), but sanitising at ingestion protects every other consumer —
    exports, digests, an agent reading the field later.
    """
    s = _text(v, cap)
    # Models sometimes emit a literal backslash-n inside the JSON string rather
    # than a newline, which then renders as "\n" in the UI.
    s = s.replace("\\n", "\n").replace("\\t", " ")
    return s.replace("<", "‹").replace(">", "›")


def _sanitize_markdown(v: Any, cap: int = 60_000) -> str:
    """
    Sanitize the agent's markdown answer. The UI renders it with ReactMarkdown
    WITHOUT rehype-raw, so raw HTML is inert (not parsed) — we therefore keep
    `<`/`>` intact (legitimate in prose like "RSI < 30" and in code fences) and
    only normalise the literal-backslash escapes models sometimes emit.
    """
    s = _text(v, cap)
    return s.replace("\\n", "\n").replace("\\t", "    ")


@sandboxRouter.post("/sandbox/result", summary="Submit sandbox run artifacts (single use)")
async def sandbox_result(request: Request, x_sandbox_key: Optional[str] = Header(None, alias="X-Sandbox-Key")):
    task = _auth(x_sandbox_key)
    task_id = task["_id"]

    raw = await request.body()
    if len(raw) > MAX_RESULT_BYTES:
        raise HTTPException(status_code=413, detail="Result payload too large.")
    try:
        import json
        body = json.loads(raw or b"{}")
    except Exception:
        raise HTTPException(status_code=400, detail="Malformed JSON body.")
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Body must be an object.")

    status = "COMPLETED" if body.get("status") == "COMPLETED" else "FAILED"
    update: Dict[str, Any] = {
        "status": status,
        "updatedAt": datetime.now(timezone.utc),
        "intent": "backtest" if body.get("intent") == "backtest" else "research",
    }

    if status == "FAILED":
        update["failureReason"] = _sanitize_display(body.get("failureReason"), 2000) or "Sandbox run failed."
    else:
        for field in ("ticker", "horizon", "analysisStyle", "strategyName", "runId", "dataSource"):
            if body.get(field) is not None:
                update[field] = _text(body[field], 200)
        # The agent's free-form markdown answer (rendered in the chat).
        if body.get("content"):
            update["content"] = _sanitize_markdown(body["content"], 60_000)
        if body.get("strategyExplanation"):
            update["strategyExplanation"] = _sanitize_display(body["strategyExplanation"], 4000)
        if body.get("analysis"):
            update["analysis"] = _sanitize_display(body["analysis"], MAX_STRING_LEN)
        if body.get("generatedCode"):
            update["generatedCode"] = _text(body["generatedCode"], 100_000)
        if body.get("codeAttempts") is not None:
            update["codeAttempts"] = int(_num(body["codeAttempts"]) or 1)

        metrics = body.get("metrics")
        if isinstance(metrics, dict):
            update["metrics"] = {
                _text(k, 64): _num(v) for k, v in list(metrics.items())[:40]
            }

        signals = body.get("signals")
        if isinstance(signals, dict):
            update["signals"] = {
                _text(k, 64): _num(v) for k, v in list(signals.items())[:40]
            }

        result = body.get("result")
        if isinstance(result, dict):
            sig = _text(result.get("signal"), 8).upper()
            update["result"] = {
                "signal": sig if sig in ("BUY", "HOLD", "SELL") else "HOLD",
                "confidence": max(0, min(100, int(_num(result.get("confidence")) or 50))),
                "targetLow": _num(result.get("targetLow")),
                "targetHigh": _num(result.get("targetHigh")),
                "summary": _sanitize_display(result.get("summary"), 4000),
                "bullCase": _sanitize_display(result.get("bullCase"), 4000),
                "bearCase": _sanitize_display(result.get("bearCase"), 4000),
                "technicalReadout": _sanitize_display(result.get("technicalReadout"), 4000),
                "keyRisks": [_sanitize_display(r, 500) for r in (result.get("keyRisks") or [])[:10]],
                "disclaimer": _sanitize_display(result.get("disclaimer"), 1000),
            }

        equity = body.get("equity")
        if isinstance(equity, dict):
            dates = [_text(d, 32) for d in (equity.get("dates") or [])[:MAX_ARRAY_LEN]]
            update["equity"] = {
                "dates": dates,
                **{k: _num_list(equity.get(k)) for k in
                   ("equity", "drawdown", "close", "open", "high", "low", "volume", "signal")},
            }
            by_symbol = equity.get("bySymbol")
            if isinstance(by_symbol, dict):
                update["equity"]["bySymbol"] = {
                    _text(code, 32): {col: _num_list(series.get(col)) for col in
                                       ("open", "high", "low", "close", "volume")}
                    for code, series in list(by_symbol.items())[:20] if isinstance(series, dict)
                }

        trades = body.get("trades")
        if isinstance(trades, list):
            update["trades"] = [{
                "entry_date": _text(t.get("entry_date"), 32),
                "exit_date": _text(t.get("exit_date"), 32),
                "entry_price": _num(t.get("entry_price")),
                "exit_price": _num(t.get("exit_price")),
                "return_pct": _num(t.get("return_pct")),
                "holding_days": int(_num(t.get("holding_days")) or 0),
                "open": bool(t.get("open")),
            } for t in trades[:MAX_TRADES] if isinstance(t, dict)]

        run_card = body.get("runCard")
        if isinstance(run_card, dict):
            def _run_card_value(v: Any) -> Any:
                if isinstance(v, (int, float)):
                    return _num(v)
                if isinstance(v, list):
                    # e.g. `codes` (the ticker list) — keep it a real array
                    # instead of falling through to str(v)'s Python repr.
                    return [_text(x, 40) for x in v[:50]]
                return _text(str(v), 200)
            update["runCard"] = {_text(k, 40): _run_card_value(v) for k, v in list(run_card.items())[:20]}

        chart = body.get("chartData")
        if isinstance(chart, dict):
            update["chartData"] = {
                "longName": _sanitize_display(chart.get("longName"), 200),
                "currency": _text(chart.get("currency"), 16),
                "sector": _sanitize_display(chart.get("sector"), 100),
                "dates": [_text(d, 32) for d in (chart.get("dates") or [])[:MAX_ARRAY_LEN]],
                "close": _num_list(chart.get("close")),
            }

        sources = body.get("sources")
        if isinstance(sources, list):
            update["sources"] = [{
                "title": _sanitize_display(x.get("title"), 200),
                "url": _text(x.get("url"), 500),
            } for x in sources[:12] if isinstance(x, dict)]

        skills_used = body.get("skillsUsed")
        if isinstance(skills_used, list):
            update["skillsUsed"] = [_text(s, 64) for s in skills_used[:12] if isinstance(s, str)]

    # Terminal-state aware: a late callback for a task already resolved is dropped.
    res = get_db()["trading_predictions"].update_one(
        {"_id": task_id, "status": {"$nin": ["COMPLETED", "FAILED"]}},
        {"$set": update, "$unset": {"sandboxKeyHash": ""}},
    )
    if res.matched_count == 0:
        return {"accepted": False, "reason": "task already in a terminal state"}

    revoke_sandbox_key(task_id)
    logger.info(f"[sandbox/result {task_id}] {status} recorded.")
    return {"accepted": True}


@sandboxRouter.get("/sandbox/context", summary="Prior turns in this task's session")
def sandbox_context(x_sandbox_key: Optional[str] = Header(None, alias="X-Sandbox-Key")):
    """
    Compact history of the conversation the current task belongs to, so the agent
    can answer follow-ups ("now try ETH", "use RSI<25 instead"). Derived from the
    task token — the sandbox cannot request another session's history.
    """
    task = _auth(x_sandbox_key)
    session_id = task.get("sessionId")
    if not session_id:
        return {"turns": []}
    prior = list(
        get_db()["trading_predictions"]
        .find(
            {"sessionId": session_id, "userId": task.get("userId"),
             "_id": {"$ne": task["_id"]}, "status": "COMPLETED"},
            {"prompt": 1, "ticker": 1, "intent": 1, "strategyName": 1,
             "content": 1, "metrics": 1, "createdAt": 1},
        )
        .sort("createdAt", 1)
        .limit(8)
    )
    turns = []
    for t in prior:
        entry = {"prompt": t.get("prompt"), "ticker": t.get("ticker"), "intent": t.get("intent")}
        # The full markdown answer is the real conversational context; a compact
        # summary is the fallback for older pipeline-era turns without `content`.
        if t.get("content"):
            entry["content"] = t["content"]
        elif t.get("intent") == "backtest":
            m = t.get("metrics") or {}
            entry["summary"] = (
                f"{t.get('strategyName') or 'strategy'} on {t.get('ticker')}: "
                f"return {m.get('total_return')}, sharpe {m.get('sharpe')}, "
                f"{m.get('trade_count')} trades"
            )
        turns.append(entry)
    return {"turns": turns}


@sandboxRouter.post("/sandbox/progress", summary="Report agent step progress")
def sandbox_progress(payload: Dict[str, Any], x_sandbox_key: Optional[str] = Header(None, alias="X-Sandbox-Key")):
    """Live thinking-timeline updates. Best-effort; never fails the run."""
    task = _auth(x_sandbox_key)
    step = {
        "name": _sanitize_display(payload.get("name"), 200),
        "status": "done" if payload.get("status") == "done" else "running",
        "detail": _sanitize_display(payload.get("detail"), 300),
        "at": datetime.now(timezone.utc).isoformat(),
    }
    get_db()["trading_predictions"].update_one(
        {"_id": task["_id"]},
        {"$push": {"steps": {"$each": [step], "$slice": -40}},
         "$set": {"status": "PROCESSING", "updatedAt": datetime.now(timezone.utc)}},
    )
    return {"ok": True}
