"""
Minimal ``src.config.accessor`` shim, standing in for Vibe-Trading's real
``EnvConfig`` (a large Pydantic settings model, ``agent/src/config/env_schema.py``,
covering dozens of unrelated subsystems: live trading, swarm, memory, channels...).

This ports only the fields the tools/loaders/engines we actually run read,
backed directly by the same env var names and defaults as their schema. A tool
gated on a key we don't set (qveris, swarm) is intentionally excluded from our
registry allowlist rather than given a field here — see sandbox/vt_tools.py.
"""

from __future__ import annotations

import os
import threading
from dataclasses import dataclass, field

_TRUTHY = frozenset({"1", "true", "yes", "on"})


def _parse_bool(value: str | None) -> bool:
    return (value or "").strip().lower() in _TRUTHY


@dataclass(frozen=True)
class _DataSection:
    aliyun_iqs_api_key: str = ""
    tushare_token: str = ""
    fred_api_key: str = ""
    vibe_trading_iwencai_key: str = ""
    vibe_trading_sec_ua: str = ""
    ccxt_exchange: str = "binance"
    rsshub_base_url: str = ""
    # Left off in the sandbox: a single-shot, ephemeral container gets no reuse
    # benefit from an on-disk loader cache, and it would need a duckdb dep we
    # don't carry.
    vibe_trading_data_cache: bool = False
    vibe_trading_data_cache_root: str = ""


@dataclass(frozen=True)
class _AgentTuningSection:
    vibe_trading_search_backends: str = ""
    vibe_trading_search_bing_fallback: bool = True
    vibe_trading_disable_bottleneck: bool = False


@dataclass(frozen=True)
class _ApiSection:
    # Empty strings mean "use only the hardcoded defaults" in path_utils.py's
    # _default_file_roots()/_default_run_roots() (agent_root/runs etc.) — we
    # never need to configure extra roots since our tools always write under
    # the default agent_root/runs path.
    vibe_trading_allowed_file_roots: str = ""
    vibe_trading_allowed_write_roots: str = ""
    vibe_trading_allowed_run_roots: str = ""


@dataclass(frozen=True)
class _EnvConfig:
    data: _DataSection = field(default_factory=_DataSection)
    agent_tuning: _AgentTuningSection = field(default_factory=_AgentTuningSection)
    api: _ApiSection = field(default_factory=_ApiSection)


_instance: _EnvConfig | None = None
_lock = threading.Lock()


def get_env_config() -> _EnvConfig:
    """Return the cached shim config, reading os.environ on first access."""
    global _instance
    if _instance is not None:
        return _instance
    with _lock:
        if _instance is not None:
            return _instance
        _instance = _EnvConfig(
            data=_DataSection(
                aliyun_iqs_api_key=os.environ.get("ALIYUN_IQS_API_KEY", ""),
                tushare_token=os.environ.get("TUSHARE_TOKEN", ""),
                fred_api_key=os.environ.get("FRED_API_KEY", ""),
                vibe_trading_iwencai_key=os.environ.get("VIBE_TRADING_IWENCAI_KEY", ""),
                vibe_trading_sec_ua=os.environ.get("VIBE_TRADING_SEC_UA", ""),
                ccxt_exchange=os.environ.get("CCXT_EXCHANGE", "binance"),
                rsshub_base_url=os.environ.get("RSSHUB_BASE_URL", ""),
                vibe_trading_data_cache=_parse_bool(os.environ.get("VIBE_TRADING_DATA_CACHE")),
                vibe_trading_data_cache_root=os.environ.get("VIBE_TRADING_DATA_CACHE_ROOT", ""),
            ),
            agent_tuning=_AgentTuningSection(
                vibe_trading_search_backends=os.environ.get("VIBE_TRADING_SEARCH_BACKENDS", ""),
                vibe_trading_search_bing_fallback=_parse_bool(
                    os.environ.get("VIBE_TRADING_SEARCH_BING_FALLBACK", "true")),
                vibe_trading_disable_bottleneck=_parse_bool(
                    os.environ.get("VIBE_TRADING_DISABLE_BOTTLENECK")),
            ),
            api=_ApiSection(
                vibe_trading_allowed_file_roots=os.environ.get("VIBE_TRADING_ALLOWED_FILE_ROOTS", ""),
                vibe_trading_allowed_write_roots=os.environ.get("VIBE_TRADING_ALLOWED_WRITE_ROOTS", ""),
                vibe_trading_allowed_run_roots=os.environ.get("VIBE_TRADING_ALLOWED_RUN_ROOTS", ""),
            ),
        )
    return _instance


def reset_env_config() -> None:
    global _instance
    with _lock:
        _instance = None
