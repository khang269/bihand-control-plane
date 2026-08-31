import logging
from datetime import datetime, timezone
from typing import Optional, Literal
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field

from fastapp.controllers.authController import get_current_user
from fastapp.models.userModel import UserModel
from fastapp.database import get_db
from fastapp.utils.utils import generateHash

logger = logging.getLogger(__name__)

tradingStudioRouter = APIRouter()

# No-billing OSS build (BYOK): nothing is deducted or gated here. `/credits`
# and `/pricing` stay as informational endpoints for UI compatibility with the
# private/hosted build this was forked from.
PREDICTION_COST = 0


class PredictionRequest(BaseModel):
    prompt: str = Field(..., min_length=2, max_length=1000, description="Free-text research request in any language, e.g. 'Will Bitcoin go up next month?', 'Phân tích cổ phiếu FPT', 'BTC-USDT outlook'")
    sessionId: Optional[str] = Field(None, description="Continue an existing conversation. Omit to start a new session.")


def estimate_prediction_cost(horizon: str = "") -> int:
    return PREDICTION_COST


@tradingStudioRouter.get("/credits", summary="Get user central credit balance")
def get_trading_credits(current_user: dict = Depends(get_current_user)):
    email = current_user.get("email")
    user_doc = UserModel._getUserByEmail(email)
    if not user_doc:
        raise HTTPException(status_code=404, detail="User not found")
    return {"credits": user_doc.get("credits", 0)}


@tradingStudioRouter.get("/pricing", summary="Get credit pricing per research prompt")
def get_trading_pricing():
    from fastapp.controllers.sandboxController import (
        INPUT_USD_PER_TOKEN, OUTPUT_USD_PER_TOKEN, CREDITS_PER_USD,
    )
    from fastapp.utils.sandboxKey import DEFAULT_BUDGET_CREDITS
    return {
        "cost": 0,
        "billing": "none — BYOK, no gating",
        "budgetPerTask": DEFAULT_BUDGET_CREDITS,
        "inputCreditsPerMillionTokens": round(INPUT_USD_PER_TOKEN * 1e6 * CREDITS_PER_USD, 2),
        "outputCreditsPerMillionTokens": round(OUTPUT_USD_PER_TOKEN * 1e6 * CREDITS_PER_USD, 2),
    }


@tradingStudioRouter.get("/correlation", summary="Rolling correlation matrix across assets")
def get_correlation(symbols: str, window: int = 90, method: str = "pearson",
                    current_user: dict = Depends(get_current_user)):
    """Correlation of daily returns. `symbols` is a comma-separated list."""
    from fastapp.services.tradingService import compute_correlation_matrix

    if method not in ("pearson", "spearman"):
        raise HTTPException(status_code=400, detail="method must be 'pearson' or 'spearman'")
    if window < 5 or window > 730:
        raise HTTPException(status_code=400, detail="window must be between 5 and 730 days")
    parts = [s.strip() for s in symbols.split(",") if s.strip()]
    try:
        return compute_correlation_matrix(parts, window=window, method=method)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.error(f"[Trading Studio] correlation failed: {exc}")
        raise HTTPException(status_code=500, detail="Failed to compute the correlation matrix.")


@tradingStudioRouter.post("/predict", summary="Create a stock prediction task from a free-text prompt")
def create_prediction(req: PredictionRequest, current_user: dict = Depends(get_current_user)):
    email = current_user.get("email")
    prompt = req.prompt.strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="A research prompt is required.")

    user = UserModel._getUserByEmail(email)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    # No-billing OSS build: no minimum-balance gate here (see sandboxController.py
    # for the same removal on the per-call LLM proxy).
    credit_cost = 0  # billed per LLM call, not held up front

    db = get_db()
    # A session groups an ordered conversation of turns. A follow-up reuses the
    # caller's sessionId (verified to belong to them); a fresh prompt starts one.
    session_id = (req.sessionId or "").strip()
    if session_id:
        owns = db["trading_predictions"].find_one(
            {"sessionId": session_id, "userId": email}, {"_id": 1}
        )
        if not owns:
            session_id = ""
    if not session_id:
        session_id = generateHash()

    task_id = generateHash()
    try:
        db["trading_predictions"].insert_one({
            "_id": task_id,
            "userId": email,
            "sessionId": session_id,
            "prompt": prompt,
            "ticker": None,          # resolved by the agent pipeline in the worker
            "horizon": None,         # inferred from the prompt
            "analysisStyle": None,   # inferred from the prompt
            "status": "PENDING",
            "failureReason": None,
            "cost": credit_cost,
            "result": None,
            "signals": None,
            "chartData": None,
            "createdAt": datetime.now(timezone.utc),
        })
    except Exception as dbe:
        logger.error(f"[Trading Studio] Failed to insert task {task_id}: {dbe}")
        UserModel._addCredits(email, credit_cost)
        try:
            db["transactions"].insert_one({
                "userId": email, "type": "refund", "amount": credit_cost,
                "createdAt": datetime.now(timezone.utc),
                "details": {"action": "failed_db_insert_refund", "taskId": task_id, "feature": "stock-prediction", "error": str(dbe)}
            })
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Failed to create prediction task.")

    try:
        from fastapp.tasks import execute_trading_prediction_task
        execute_trading_prediction_task.delay(task_id)
    except Exception as celery_err:
        logger.error(f"[Trading Studio] Failed to dispatch task {task_id} to Celery: {celery_err}")
        UserModel._addCredits(email, credit_cost)
        db["trading_predictions"].update_one(
            {"_id": task_id},
            {"$set": {"status": "FAILED", "failureReason": "Task queue unavailable. Credits refunded.", "updatedAt": datetime.now(timezone.utc)}}
        )
        try:
            db["transactions"].insert_one({
                "userId": email, "type": "refund", "amount": credit_cost,
                "createdAt": datetime.now(timezone.utc),
                "details": {"action": "failed_celery_dispatch_fallback_refund", "taskId": task_id, "feature": "stock-prediction", "error": str(celery_err)}
            })
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Prediction queue is unavailable. Credits were refunded.")

    return {"success": True, "taskId": task_id, "sessionId": session_id, "status": "PENDING",
            "newBalance": UserModel._getUserByEmail(email).get("credits", 0)}


@tradingStudioRouter.get("/sessions", summary="List conversation sessions")
def list_sessions(limit: int = 40, current_user: dict = Depends(get_current_user)):
    """One row per session: title (first prompt), last activity, turn count."""
    email = current_user.get("email")
    db = get_db()
    pipeline = [
        {"$match": {"userId": email}},
        {"$sort": {"createdAt": 1}},
        {"$group": {
            "_id": {"$ifNull": ["$sessionId", "$_id"]},
            "title": {"$first": "$prompt"},
            "createdAt": {"$first": "$createdAt"},
            "lastActivity": {"$last": "$createdAt"},
            "turns": {"$sum": 1},
            "lastStatus": {"$last": "$status"},
        }},
        {"$sort": {"lastActivity": -1}},
        {"$limit": limit},
    ]
    rows = list(db["trading_predictions"].aggregate(pipeline))
    return {"sessions": [{
        "sessionId": r["_id"], "title": r.get("title"),
        "createdAt": r.get("createdAt"), "lastActivity": r.get("lastActivity"),
        "turns": r.get("turns", 1), "lastStatus": r.get("lastStatus"),
    } for r in rows]}


@tradingStudioRouter.get("/sessions/{session_id}", summary="Get all turns in a session")
def get_session(session_id: str, current_user: dict = Depends(get_current_user)):
    """Full ordered thread for one conversation."""
    email = current_user.get("email")
    db = get_db()
    turns = list(
        db["trading_predictions"]
        .find({"sessionId": session_id, "userId": email})
        .sort("createdAt", 1)
    )
    if not turns:
        # Back-compat: a pre-session task whose _id was used as the session id.
        turns = list(db["trading_predictions"].find({"_id": session_id, "userId": email}))
    if not turns:
        raise HTTPException(status_code=404, detail="Session not found")
    for t in turns:
        t["_id"] = str(t["_id"])
    return {"sessionId": session_id, "turns": turns}


@tradingStudioRouter.get("/history", summary="Get user prediction/session history")
def get_prediction_history(limit: int = 30, skip: int = 0, current_user: dict = Depends(get_current_user)):
    """Lightweight list for the sessions rail — heavy artifacts are excluded."""
    email = current_user.get("email")
    db = get_db()
    projection = {
        "prompt": 1, "ticker": 1, "status": 1, "intent": 1, "createdAt": 1, "cost": 1,
        "horizon": 1, "failureReason": 1, "strategyName": 1, "runId": 1,
        "result.signal": 1, "result.confidence": 1,
        "metrics.total_return": 1, "metrics.sharpe": 1,
    }
    preds = list(
        db["trading_predictions"].find({"userId": email}, projection)
        .sort("createdAt", -1).skip(skip).limit(limit)
    )
    for p in preds:
        p["_id"] = str(p["_id"])
    return {"predictions": preds}


@tradingStudioRouter.get("/runs", summary="Backtest report library")
def list_runs(limit: int = 50, skip: int = 0, current_user: dict = Depends(get_current_user)):
    """Completed backtest runs only — powers the Reports view."""
    email = current_user.get("email")
    db = get_db()
    projection = {
        "prompt": 1, "ticker": 1, "status": 1, "createdAt": 1, "runId": 1,
        "strategyName": 1, "metrics": 1, "runCard": 1, "codeAttempts": 1,
    }
    runs = list(
        db["trading_predictions"]
        .find({"userId": email, "intent": "backtest", "status": "COMPLETED"}, projection)
        .sort("createdAt", -1).skip(skip).limit(limit)
    )
    for r in runs:
        r["_id"] = str(r["_id"])
    return {"runs": runs}


@tradingStudioRouter.get("/tasks/{task_id}", summary="Get specific prediction task status/result")
def get_prediction_task(task_id: str, current_user: dict = Depends(get_current_user)):
    email = current_user.get("email")
    db = get_db()
    task = db["trading_predictions"].find_one({"_id": task_id, "userId": email})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    task["_id"] = str(task["_id"])
    return task
