"""
Start Trading Studio sandbox executions on Cloud Run Jobs.

Uses the worker's ambient Workload Identity credentials (which hold
`roles/run.invoker` on the job) via the Cloud Run Admin v2 REST API, so no extra
client library is needed.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, List

import requests

logger = logging.getLogger(__name__)

RUN_API = "https://run.googleapis.com/v2"


def _project() -> str:
    return os.environ.get("GOOGLE_CLOUD_PROJECT_ID", "")


def _region() -> str:
    return os.environ.get("GCP_REGION", "us-central1")


def _job_name() -> str:
    # Set per environment — see TRADING_SANDBOX_JOB in .env.example.
    return os.environ.get("TRADING_SANDBOX_JOB", "bihand-trading-sandbox")


def _access_token() -> str:
    import google.auth
    import google.auth.transport.requests

    creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
    creds.refresh(google.auth.transport.requests.Request())
    return creds.token


def start_sandbox_execution(task_id: str, sandbox_key: str, prompt: str,
                            api_base: str) -> Dict[str, Any]:
    """
    Trigger one execution with per-execution environment overrides.

    Returns the long-running-operation body. Raises on failure so the caller can
    refund and mark the task FAILED.
    """
    project, region, job = _project(), _region(), _job_name()
    if not project:
        raise RuntimeError("GOOGLE_CLOUD_PROJECT_ID is not configured")

    url = f"{RUN_API}/projects/{project}/locations/{region}/jobs/{job}:run"
    body = {
        "overrides": {
            "containerOverrides": [{
                "env": [
                    {"name": "TASK_ID", "value": task_id},
                    {"name": "SANDBOX_KEY", "value": sandbox_key},
                    {"name": "API_BASE", "value": api_base},
                    {"name": "PROMPT", "value": prompt},
                ],
            }],
            "taskCount": 1,
        }
    }

    resp = requests.post(
        url,
        headers={"Authorization": f"Bearer {_access_token()}",
                 "Content-Type": "application/json"},
        json=body,
        timeout=30,
    )
    if resp.status_code >= 400:
        raise RuntimeError(f"Cloud Run job start failed ({resp.status_code}): {resp.text[:500]}")
    return resp.json()
