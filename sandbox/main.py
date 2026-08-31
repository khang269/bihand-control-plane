"""
Cloud Run job entrypoint.

Environment (supplied per execution as overrides):
  TASK_ID      the trading_predictions document id
  SANDBOX_KEY  per-task token; the only credential this container holds
  API_BASE     Bihand API base URL
  PROMPT       the user's research request

Always submits a terminal result, so a task never hangs waiting on a job that
died. Exit code is 0 on a delivered result — a failed *strategy* is a normal
outcome, not a job failure.
"""

from __future__ import annotations

import logging
import os
import sys
import traceback

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("sandbox")


def main() -> int:
    from sandbox.agent import run
    from sandbox.client import ApiClient, BudgetExhausted

    try:
        api = ApiClient()
    except KeyError as exc:
        logger.error(f"missing required environment variable: {exc}")
        return 2

    prompt = os.environ.get("PROMPT", "").strip()
    if not prompt:
        logger.error("PROMPT is empty")
        try:
            api.submit({"status": "FAILED", "failureReason": "No research prompt was provided."})
        except Exception:
            pass
        return 2

    try:
        payload = run(api, prompt)
        api.submit(payload)
        logger.info(f"task {api.task_id} completed ({payload.get('intent')})")
        return 0

    except BudgetExhausted as exc:
        logger.warning(f"task {api.task_id} hit its credit budget: {exc}")
        _safe_submit(api, f"Credit budget exhausted before the run finished: {exc}")
        return 0

    except Exception as exc:
        logger.error(f"task {api.task_id} failed: {exc}\n{traceback.format_exc()}")
        _safe_submit(api, str(exc))
        return 0


def _safe_submit(api, reason: str) -> None:
    """Deliver the failure; if even that fails the server's sweep will time it out."""
    try:
        api.submit({"status": "FAILED", "failureReason": reason[:2000]})
    except Exception as exc:
        logger.error(f"could not submit failure result: {exc}")


if __name__ == "__main__":
    sys.exit(main())
