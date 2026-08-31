"""
Vibe-Trading tool discovery — ports their build_registry() auto-discovery.

Imports every module under ``src/tools/`` (the real package, matching their
repo layout exactly — this is also where their tool files cross-reference each
other, e.g. ``src.factors.bench_runner`` importing helpers from
``src.tools.alpha_bench_tool``), collects concrete ``BaseTool`` subclasses
(recursively), filters by ``check_available()``, and registers the survivors.

Everything needed for the free/key-free/stateless tools has been physically
ported into ``src/`` and ``backtest/`` at the repo root (mirroring their
``agent/src/`` and ``agent/backtest/`` layout): the loader registry + 9 free
DataLoader classes, the full backtest engine (runner.py + per-market engines +
validation/benchmark/run_card/metrics), the factor library (registry + the
~350-factor zoo), and the shared agent/tools/config/security plumbing.

Excluded, matching their own check_available()-gated design: paid-key-only
tools (qveris, some tushare paths — gate themselves, harmless to list) and
tools needing subsystems architecturally incompatible with a stateless,
single-task Cloud Run job — live trading, swarm multi-agent orchestration,
local session/goal/memory persistence, shadow-account journals, OCR/vision.
Shell execution and conversation-compaction tools are denylisted outright:
the sandbox's whole security model is that no untrusted flow runs arbitrary
shell here, regardless of whether the dependency happens to be available.
"""

from __future__ import annotations

import importlib
import logging
import pkgutil
from collections import deque
from pathlib import Path
from typing import List

from src.agent.tools import BaseTool, ToolRegistry

logger = logging.getLogger(__name__)

# Shell / process-control / conversation-management tools: excluded regardless
# of dependency availability. The sandbox's security model depends on no
# untrusted flow ever reaching arbitrary shell execution in this container.
_DENYLIST = {"bash", "background_run", "check_background", "compact"}

_ALLOWLIST = {
    # Web + symbol resolution (richer multi-engine/SSRF-hardened/injection-scanned
    # versions of what a minimal native implementation would offer).
    "web_search", "read_url", "search_symbol",

    # Market data + backtesting — the full engine (runner.py, per-market engines,
    # validation/benchmark/run_card, the 9 free loader classes).
    "get_market_data", "backtest",
    "write_file", "read_file", "edit_file",  # config.json / code/signal_engine.py I/O for `backtest`
    "pattern", "financial_rigor", "report_audit",

    # Factor research (registry + ~350-factor zoo: alpha101, gtja191, qlib158, academic).
    "factor_analysis", "alpha_bench", "alpha_compare", "alpha_zoo",

    # Skills: load the full methodology doc; save a new one for future turns
    # in the same session (writes under the ephemeral container fs).
    "load_skill", "save_skill",

    # Free, key-free data tools riding on the ported backtest.loaders.* clients
    # (Eastmoney for A-share, Yahoo for US/HK/crypto/options, SEC EDGAR for US filings).
    "get_block_trades", "get_dragon_tiger", "get_financial_statements", "get_fund_flow",
    "get_fundamentals", "get_lockup_expiry", "get_margin_trading", "screen_market",
    "get_northbound_flow", "get_options_chain", "get_research_reports", "get_sec_filings",
    "get_sector_info", "get_shareholder_count", "get_stock_news", "get_stock_profile",

    # Gate themselves on an optional key we don't currently set (FRED_API_KEY,
    # VIBE_TRADING_IWENCAI_KEY, QVERIS_API_KEY); check_available() excludes them
    # from the registry until/unless one is configured. Harmless to list.
    "get_macro_series", "iwencai_search",
}


def _discover_subclasses() -> List[type[BaseTool]]:
    """Import every module in src/tools/, then collect concrete BaseTool subclasses."""
    import src.tools as tools_pkg

    pkg_dir = str(Path(tools_pkg.__file__).parent)
    for _, module_name, _ in pkgutil.iter_modules([pkg_dir]):
        if module_name.startswith("_"):
            continue
        try:
            importlib.import_module(f"src.tools.{module_name}")
        except Exception as exc:  # noqa: BLE001 — unmet deps → skip, exactly their policy
            logger.debug("skipped src.tools.%s: %s", module_name, exc)

    classes: List[type[BaseTool]] = []
    queue = deque(BaseTool.__subclasses__())
    while queue:
        cls = queue.popleft()
        if getattr(cls, "name", ""):
            classes.append(cls)
        queue.extend(cls.__subclasses__())
    return classes


def build_vt_registry() -> ToolRegistry:
    """Discover and instantiate the available Vibe-Trading tools. Never raises."""
    registry = ToolRegistry()
    try:
        classes = _discover_subclasses()
    except Exception as exc:  # noqa: BLE001
        logger.warning("vt tool discovery failed: %s", exc)
        return registry

    for cls in classes:
        try:
            if cls.name in _DENYLIST or cls.name not in _ALLOWLIST:
                continue
            if not cls.check_available():
                continue
            registry.register(cls())
        except Exception as exc:  # noqa: BLE001 — a tool that won't construct is skipped
            logger.debug("failed to register vt tool %s: %s", getattr(cls, "name", "?"), exc)
    if registry.tool_names:
        logger.info("registered vt tools: %s", ", ".join(sorted(registry.tool_names)))
    return registry
