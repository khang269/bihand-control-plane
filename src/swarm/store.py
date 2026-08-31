"""
Minimal stand-in for Vibe-Trading's src/swarm/store.py, providing only the one
function src/tools/path_utils.py needs (swarm multi-agent orchestration itself
is out of scope for this single-task Cloud Run sandbox).
"""

from __future__ import annotations

from pathlib import Path


def swarm_runs_root() -> Path:
    """Match the real implementation's derivation: <agent_root>/.swarm/runs."""
    return Path(__file__).resolve().parents[2] / ".swarm" / "runs"
