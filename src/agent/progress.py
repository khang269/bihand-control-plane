"""
Structured tool-progress channel, ported verbatim from Vibe-Trading's
agent/src/agent/progress.py (pure stdlib). Registered as ``src.agent.progress``
by vt_base.install_src_shim() so copied tools can ``emit_progress(...)``
unchanged.

We don't wire an emitter (no thread-local emitter is ever installed here) —
our own agent.py already reports one progress step per tool call via
api.progress(), so this intentionally no-ops rather than double-reporting
their tools' internal sub-stages. emit_progress() is designed to be a silent
no-op with no active emitter, so this is exactly its documented behavior.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Optional


@dataclass(frozen=True)
class ProgressEvent:
    tool: str = ""
    stage: str = ""
    current: Optional[int] = None
    total: Optional[int] = None
    message: str = ""
    elapsed_s: float = 0.0
    ts: float = field(default_factory=time.time)

    def to_dict(self) -> Dict[str, Any]:
        return {"tool": self.tool, "stage": self.stage, "current": self.current,
                "total": self.total, "message": self.message,
                "elapsed_s": round(self.elapsed_s, 2), "ts": self.ts}


_local = threading.local()


def _set_emitter(emit: Optional[Callable[[ProgressEvent], None]]) -> None:
    if emit is None:
        if hasattr(_local, "emit"):
            del _local.emit
        return
    _local.emit = emit


def _get_emitter() -> Optional[Callable[[ProgressEvent], None]]:
    return getattr(_local, "emit", None)


def emit_progress(stage: str = "", *, current: Optional[int] = None,
                   total: Optional[int] = None, message: str = "") -> None:
    """No-ops when no emitter is installed for the current thread (our case)."""
    emit = _get_emitter()
    if emit is None:
        return
    try:
        emit(ProgressEvent(stage=stage, current=current, total=total, message=message))
    except Exception:
        pass  # progress emission must never break a tool
