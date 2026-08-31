"""
The Trading Studio agent, executed inside the Cloud Run job.

A general ReAct tool-calling agent (ported from Vibe-Trading's AgentLoop): given
the user's request and the session's conversation history, it decides which
tools to call — web search, page reading, symbol lookup, market data, the full
backtest engine, factor research — loops until it can answer, and returns a
free-form GitHub-flavored markdown reply plus any backtest Report artifacts.

Tool discovery (sandbox.vt_tools.build_vt_registry) is Vibe-Trading's own
build_registry(): every self-contained, key-free tool under src/tools/ is
registered exactly as their agent would see it. This module holds no bespoke
tool implementations of its own — it is purely the ReAct loop plus the
artifact-ingestion glue that turns their tool JSON envelopes (and, for a
backtest, the files it wrote under a run_dir) into our /sandbox/result schema.

Every LLM turn goes back through the Bihand server (the LiteLLM proxy), which
meters tokens and bills the specific task. This process holds no server
credential beyond the per-task token.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from sandbox.client import ApiClient, BudgetExhausted
from sandbox.vt_tools import build_vt_registry
from src.agent.skills import SkillsLoader

logger = logging.getLogger(__name__)

# Each iteration is one billed LLM call; the task budget cap (server-side) is the
# hard stop. Backtesting is a multi-step protocol (write config.json, write
# code/signal_engine.py, call backtest, possibly repair and retry), and a
# multi-run comparison (e.g. "vs buy-and-hold") repeats that whole protocol a
# second time under a different run_dir — confirmed in production hitting the
# old cap of 18 before reaching a final answer, at only ~65 of the 200-credit
# budget, so iterations (not cost) were the binding constraint. Matched to
# Vibe-Trading's own real default (agent/src/session/service.py: AgentLoop is
# constructed with max_iterations=50 for every standard session) after their
# reference agent needed 24 calls to fully complete a 5-asset portfolio
# request that ours cut short at the old 24-call cap; 50 still leaves ample
# room under the 200-credit budget at ~3.6 credits/call (~180 credits).
MAX_ITERS = 50

# Tools covered by their own generic label below; anything else gets a
# Title Case fallback from its name.
_PROGRESS_LABELS = {
    "web_search": "Searching the web",
    "read_url": "Reading a web page",
    "search_symbol": "Resolving symbol",
    "get_market_data": "Fetching market data",
    "write_file": "Writing strategy code",
    "read_file": "Reading file",
    "edit_file": "Editing file",
    "backtest": "Running backtest",
    "pattern": "Detecting chart patterns",
    "factor_analysis": "Analyzing factor",
    "alpha_bench": "Benchmarking factor",
    "alpha_compare": "Comparing factors",
    "alpha_zoo": "Browsing factor zoo",
    "load_skill": "Loading skill",
    "save_skill": "Saving skill",
}

# Tools described individually in the "Core workflow" section of the system
# prompt; excluded from the auto-generated "Additional tools" listing so they
# aren't described twice.
_CORE_TOOLS = {"web_search", "read_url", "search_symbol", "get_market_data",
               "write_file", "read_file", "edit_file", "backtest"}


def _tools_block(registry) -> str:
    """One-line-per-tool listing of the discovered tools beyond the core
    workflow set described explicitly in the system prompt."""
    if not registry or not registry.tool_names:
        return ""
    extra = [n for n in sorted(registry.tool_names) if n not in _CORE_TOOLS]
    if not extra:
        return ""
    lines = ["\n## Additional data & analysis tools"]
    for name in extra:
        tool = registry.get(name)
        desc = (tool.description or "").split(". ")[0].strip() if tool else ""
        lines.append(f"  - {name}: {desc}")
    return "\n".join(lines) + "\n"


def _system_prompt(skills_block: str, tools_block: str) -> str:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return f"""You are Bihand's finance research agent. You help users analyze stocks, crypto,
indices, FX and commodities: reading markets, researching news and catalysts, backtesting
trading strategies, and answering follow-up questions in a conversation.

TODAY'S DATE: {today}

## Core workflow tools
- web_search / read_url — current news, catalysts, filings, articles (with source citations).
- search_symbol — resolve a company/asset name to candidate ticker symbols across markets.
- get_market_data — OHLCV bars through the shared loader registry (Yahoo/OKX/Binance/Stooq/
  Eastmoney/Tencent/Sina/yfinance/local, with automatic fallback).
- write_file / read_file / edit_file — operate on one "run" (a scratch folder for this task).
  EVERY TASK STARTS IN A BRAND-NEW, EMPTY ENVIRONMENT — even on a follow-up in this same
  conversation, nothing from an earlier turn's run exists here. Never call read_file before you
  have called write_file (and usually backtest) at least once in THIS task; there is nothing to
  read yet, and guessing at a filename before writing anything will just fail.
  On your FIRST write_file call, use path="runs/<short-id>/config.json" (pick a short id once,
  e.g. "aapl-sma") — this establishes the run for every later call in this task. After that,
  `path` is just the filename relative to that same run — "code/signal_engine.py",
  "artifacts/trades.csv" — no "runs/" prefix needed again; it's tracked for you automatically.
- backtest — takes `run_dir` set to that same "runs/<short-id>" string (no filename suffix) and
  runs the full engine (per-market simulation, benchmark comparison, trade log, equity curve).

## How to backtest a strategy
1. write_file(path="runs/<short-id>/config.json", content=a JSON object): required keys `codes`
   (list of symbols, e.g. ["AAPL.US"], ["BTC-USDT"], ["700.HK"]), `start_date`, `end_date`
   (YYYY-MM-DD). Optional: `source` (default "auto" — auto-detects per symbol with fallback),
   `interval` (default "1D"), `engine` (default "daily"), `initial_cash` (default 1000000).
   Multi-asset PORTFOLIO requests ("build me a portfolio of X/Y/Z", "allocate across these
   assets", target-return/risk asks): this is ONE backtest, not one per asset. Put every ticker
   in the same `codes` list and add `optimizer` + `optimizer_params` to this same config.json —
   the built-in engine computes real optimized weights across the whole list in that single run.
   ALWAYS load_skill("asset-allocation") first to pick the optimizer (5 choices: equal_volatility,
   risk_parity, mean_variance, max_diversification, turnover_aware) and its params — do not guess
   them. signal_engine.py for this case is trivial: return a constant fully-invested signal (1.0)
   for every code in data_map; the optimizer, not the signal, decides each asset's weight. Never
   backtest assets one-by-one to build a portfolio — that burns the iteration budget and cannot
   produce real cross-asset weights (there is no portfolio-level result to compare against).
2. write_file(path="code/signal_engine.py", content=a complete module) implementing:
   ```
   import pandas as pd
   class SignalEngine:
       def __init__(self):
           pass  # no required arguments
       def generate(self, data_map):
           df = data_map["AAPL.US"]  # DatetimeIndex; open/high/low/close/volume columns
           signals = pd.Series(0.0, index=df.index)
           # ... your logic, using only data up to the current bar — never look ahead ...
           return {{"AAPL.US": signals}}  # target long exposure per bar: 1.0 long, 0.0 flat
   ```
   `generate()` must be a PURE function of `data_map` — pandas/numpy/math computation only, nothing
   else. In particular, never do any of these inside signal_engine.py (a static scanner rejects
   them and you'll waste a repair cycle):
   - No file I/O of any kind — no `open(...)`, no writing logs, no reading extra files.
   - No network/process modules — no requests/httpx/urllib/socket/subprocess/multiprocessing.
   - No `eval`/`exec`/`compile`/`__import__`/`globals`/`locals`.
   - NEVER intentionally trigger ANY exception to "surface" or self-check a value you computed —
     not `raise ValueError(f"Sharpe: {{x}}")`, and not workarounds that reach the same result
     through an accidental-looking error either: indexing a dict/list with a key/index you know
     doesn't exist (e.g. `some_dict[f"Sharpe={{x:.4f}}"]`), an assert that's really a debug print,
     a deliberate division by zero, etc. Whatever error TYPE it is, if the message you're causing
     contains a value YOU computed, it's this same mistake and it will just fail the run. There is
     no way to "print", "log", or "return early" a value from generate() other than the function's
     actual return — nothing else you do inside it is ever visible to you. You never need to
     compute benchmark comparisons yourself either: backtest does that automatically and returns
     benchmark_return/excess_return/information_ratio in `metrics` — signal_engine.py only ever
     returns the signal Series, nothing else, and its only job is that one return value.
3. backtest(run_dir="runs/<short-id>") — same short-id as step 1. On success ITS RESPONSE ALREADY
   HAS A TOP-LEVEL `metrics` OBJECT (total_return, sharpe, max_drawdown, win_rate, trade_count,
   benchmark_return, ...) and `dataSources` — read the answer straight from those two fields.
   STOP THERE: do not call read_file, do not guess artifact filenames (there is no metrics.json
   or summary.json — you never need to open a file to see metrics), and do not run backtest
   again once you have a successful result — write your final markdown answer immediately. The
   ONLY reason to call read_file after a successful backtest is if the user explicitly asked to
   see individual trade rows (and even then, use path="artifacts/trades.csv" — nothing else).
   On failure it returns a validation/runtime error: fix code/signal_engine.py in place
   (write_file again, same path) and retry backtest — at most 2-3 repair attempts, then report
   the failure honestly instead of continuing to retry.
4. Multiple runs in one task: sometimes legitimate — e.g. the built-in `benchmark_return` in
   `metrics` compares against a market INDEX (S&P 500 for US equities, etc.), not buy-and-hold of
   the traded asset itself, so if the user specifically asked "vs buy-and-hold", a second run with
   an always-fully-invested SignalEngine under a DIFFERENT short-id is the right way to get that
   number. If you do this: each run is sandboxed to itself — a read_file call in run B can NEVER
   see run A's files (not a bug, just how it's isolated), and you never need it to: you already
   have BOTH runs' metrics from their own backtest() responses earlier in this conversation —
   just remember those numbers and compare them directly in your final answer.
{tools_block}
## Skills (load_skill to read the full methodology before a specialized task)
Each skill is a detailed methodology guide. When a request calls for a specific technique — a
chart pattern, an options structure, a factor study, a regime/correlation analysis, a valuation
model — call `load_skill(name)` FIRST to read the exact method, then apply it with the tools
above. Available skills by category:
{skills_block}

## How to work
- Decide what the user actually wants from their message AND the conversation so far (a short
  follow-up like "now try ETH" or "give me a timeline" builds on earlier turns).
- For price/technical questions: get_market_data, then interpret the series honestly.
- For "what's happening / why / news / outlook": web_search (and read_url for depth), then weigh
  the findings against the data.
- For "backtest / test / simulate / optimize a strategy": follow the backtest workflow above,
  then interpret the metrics (Sharpe, return, drawdown, win rate) versus the benchmark, noting
  sample-size caveats for a small trade count.
- For diversification / cross-asset comparisons (no allocation asked for): get_market_data on
  each asset and compute/discuss correlation directly (load_skill("correlation-analysis")).
- For "build/optimize a portfolio across these assets" / target return-or-risk requests: this is
  the multi-asset optimizer path in the backtest workflow above (one config.json, one
  signal_engine.py, one backtest call) — not a per-asset loop.
- For a specialized method named or implied by the request: load_skill first, then execute it.

## Final answer
- Write the final answer as GitHub-flavored **Markdown**. Use pipe tables for structured data
  (timelines, metric breakdowns, comparisons), headings, and bullet lists. Be well-organized.
- Cite web sources inline as [1], [2] matching the order you found them; the UI lists them.
- Be balanced (state both bull and bear where relevant). This is research, not financial advice
  — say so briefly when you give a market view.
- Answer in the same language the user wrote in.
- Keep calling tools until you can fully answer, then stop and write the markdown reply."""


def _detail(name: str, result: str) -> str:
    """A short human detail for the progress timeline, parsed from the tool JSON."""
    try:
        d = json.loads(result)
    except Exception:
        return ""
    if name == "backtest":
        if d.get("status") == "ok":
            return "backtest complete"
        # Two distinct failure shapes reach here:
        #  1. ToolRegistry.execute()'s own generic catch, when run_backtest()
        #     itself raised (e.g. subprocess.TimeoutExpired) — {"status":
        #     "error", "tool": "backtest", "error": "<exception message>"}.
        #     This was being silently discarded below, hiding real timeouts
        #     behind an unhelpful "no stdout/stderr captured" — check it first.
        if d.get("error"):
            return f"error: {str(d['error'])[:120]}"
        #  2. backtest_tool.py's own envelope on a clean subprocess failure —
        #     no top-level "error" key; the message is JSON printed to stdout
        #     by the subprocess (config/SignalEngine validation) or, for an
        #     unhandled exception inside it, the last line of stderr.
        stdout = (d.get("stdout") or "").strip()
        try:
            inner = json.loads(stdout.splitlines()[-1]) if stdout else {}
            msg = inner.get("error")
        except Exception:
            msg = None
        if not msg:
            msg = (d.get("stderr") or "").strip().splitlines()[-1:] or []
            msg = msg[0] if msg else f"exit code {d.get('exit_code')}, no stdout/stderr captured"
        return f"error: {str(msg)[:120]}"
    status = d.get("status") or ("ok" if d.get("ok") else None)
    if status == "error" or d.get("ok") is False:
        return f"error: {str(d.get('error'))[:80]}"
    if name == "web_search":
        return f"{len(d.get('results', []))} result(s)"
    if name == "get_market_data":
        codes = [k for k in d.keys() if k != "_unresolved"]
        return ", ".join(codes[:4]) or "no data"
    if name == "search_symbol":
        data = d.get("data") or {}
        cands = [c.get("symbol") for c in (data.get("candidates") or [])[:4]]
        return ", ".join(c for c in cands if c)
    if name == "load_skill":
        return "loaded" if d.get("status") == "ok" else "not found"
    return "done"


_MAX_TOOL_RESULT_CHARS = 6000

# Ported from Vibe-Trading's agent/src/agent/loop.py (their actual tuning
# constants, not guessed): compaction is TOKEN-TRIGGERED, re-evaluated every
# iteration against the whole transcript, and tiered — not a flat per-message
# truncation on a fixed age schedule. Their default TOKEN_THRESHOLD is 40,000
# (agent/src/config/env_schema.py); ours is unchanged.
_TOKEN_THRESHOLD = 40_000
_KEEP_RECENT = 3            # microcompact: most recent N tool results kept intact
_COLLAPSE_PRESERVE_RECENT = 6   # context_collapse: most recent N messages untouched
_COLLAPSE_TEXT_MIN = 2400    # only collapse content longer than this
_COLLAPSE_HEAD = 900         # chars kept from the start
_COLLAPSE_TAIL = 500         # chars kept from the end


def _estimate_tokens(messages: List[Dict[str, Any]]) -> int:
    """Their exact estimate: ~4 chars/token over the whole serialized transcript."""
    return len(json.dumps(messages, default=str, ensure_ascii=False)) // 4


def _microcompact(messages: List[Dict[str, Any]]) -> None:
    """Layer 1 (fires at 50% of threshold): wipe every tool result except the
    most recent _KEEP_RECENT to the literal "[cleared]" — their exact scheme.
    `backtest` results are exempted here (a deviation from upstream): they're
    already small (our enriched top-level `metrics` dict, not their bulkier
    stdout) and load-bearing across a whole multi-run task — e.g. a "vs
    buy-and-hold" request runs a second backtest specifically so the model can
    compare both runs' numbers, and confirmed in production, clearing the
    first run's metrics before that comparison happens sent the model into a
    read_file retry loop trying to recover numbers this had just erased."""
    tool_msgs = [m for m in messages if m.get("role") == "tool"]
    if len(tool_msgs) <= _KEEP_RECENT:
        return
    for m in tool_msgs[:-_KEEP_RECENT]:
        if m.get("name") == "backtest":
            continue
        content = m.get("content", "")
        if isinstance(content, str) and len(content) > 100:
            m["content"] = "[cleared]"


def _context_collapse(messages: List[Dict[str, Any]]) -> None:
    """Layer 2 (fires at 70% of threshold): fold long text blocks in older
    messages down to head+tail, zero API cost — their exact scheme."""
    if len(messages) <= _COLLAPSE_PRESERVE_RECENT + 1:
        return
    for m in messages[1:-_COLLAPSE_PRESERVE_RECENT]:
        content = m.get("content")
        if not isinstance(content, str) or len(content) <= _COLLAPSE_TEXT_MIN:
            continue
        if content == "[cleared]":
            continue
        head, tail = content[:_COLLAPSE_HEAD], content[-_COLLAPSE_TAIL:]
        trimmed = len(content) - _COLLAPSE_HEAD - _COLLAPSE_TAIL
        m["content"] = f"{head}\n\n...[{trimmed} chars collapsed]...\n\n{tail}"


def _compact_messages(messages: List[Dict[str, Any]]) -> None:
    """Re-evaluate token pressure and escalate exactly like their loop.py does.
    No Layer 3 (their `_auto_compact` spends an extra LLM call to summarize) —
    out of scope for a per-task-billed sandbox with its own iteration cap;
    Layers 1-2 are pure string operations with zero added cost."""
    tokens = _estimate_tokens(messages)
    if tokens > int(_TOKEN_THRESHOLD * 0.5):
        _microcompact(messages)
    if _estimate_tokens(messages) > int(_TOKEN_THRESHOLD * 0.7):
        _context_collapse(messages)


def _build_history(context: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    """Prior completed turns → native user/assistant message pairs (Vibe-Trading's
    history-injection pattern), so the model has real conversational context."""
    msgs: List[Dict[str, str]] = []
    for t in context[-8:]:
        if t.get("prompt"):
            msgs.append({"role": "user", "content": str(t["prompt"])})
        answer = t.get("content") or t.get("summary") or ""
        msgs.append({"role": "assistant", "content": str(answer)[:6000]})
    return msgs


class _RunState:
    """Accumulates side artifacts across the ReAct loop: web citations, the
    last successful backtest's artifacts, a price series for the chart
    sparkline, resolved data sources, and skills the agent loaded."""

    def __init__(self, task_id: str) -> None:
        self.task_id = task_id
        self.sources: List[Dict[str, str]] = []
        self.data_sources: List[str] = []
        self.skills_used: List[str] = []
        self.chart: Optional[Dict[str, Any]] = None
        self.backtest: Optional[Dict[str, Any]] = None
        self.last_run_dir: Optional[str] = None

    def ingest(self, name: str, args: Dict[str, Any], result: str) -> None:
        self._track_run_dir(name, args)
        try:
            d = json.loads(result)
        except Exception:
            return
        try:
            if name == "web_search":
                self._ingest_web_search(d)
            elif name == "read_url":
                self._ingest_read_url(d)
            elif name == "get_market_data":
                self._ingest_market_data(d)
            elif name == "backtest":
                self._ingest_backtest(args, d)
            elif name == "load_skill" and d.get("status") == "ok":
                skill_name = str(args.get("name") or "").strip()
                if skill_name and skill_name not in self.skills_used:
                    self.skills_used.append(skill_name)
        except Exception:  # noqa: BLE001 — artifact extraction is best-effort
            logger.exception("artifact ingestion failed for tool %s", name)

    def _track_run_dir(self, name: str, args: Dict[str, Any]) -> None:
        """Remember the run_dir this task is using — backtest's own `run_dir`
        param, or the run_dir the dispatch loop resolved for a write_file/
        read_file/edit_file call — so later calls that omit it get it
        injected automatically."""
        if name == "backtest" or name in _WORKSPACE_PATH_TOOLS:
            rd = args.get("run_dir")
            if isinstance(rd, str) and rd.strip():
                self.last_run_dir = rd.strip().lstrip("/")

    def _add_source(self, title: str, url: str) -> None:
        if url and not any(s["url"] == url for s in self.sources):
            self.sources.append({"title": title or url, "url": url})

    def _ingest_web_search(self, d: Dict[str, Any]) -> None:
        for r in d.get("results") or []:
            if isinstance(r, dict) and r.get("url"):
                self._add_source(r.get("title", ""), r["url"])

    def _ingest_read_url(self, d: Dict[str, Any]) -> None:
        if d.get("status") == "ok" and d.get("url"):
            self._add_source(d.get("title") or d["url"], d["url"])

    def _ingest_market_data(self, d: Dict[str, Any]) -> None:
        """Vibe-Trading's fetch_market_data returns {code: rows-or-capped-dict};
        keep the first resolved code's closes as the chart sparkline."""
        for code, value in d.items():
            if code == "_unresolved":
                continue
            rows = value.get("data") if isinstance(value, dict) else value
            if not isinstance(rows, list) or len(rows) < 2:
                continue
            dates = [r.get("trade_date") or r.get("date") for r in rows]
            closes = [r.get("close") for r in rows]
            if any(c is None for c in closes):
                continue
            self.chart = {
                "longName": code, "currency": None, "sector": None,
                "dates": [str(dt)[:10] for dt in dates][-90:],
                "close": [float(c) for c in closes][-90:],
            }
            break

    def _ingest_backtest(self, args: Dict[str, Any], d: Dict[str, Any]) -> None:
        if d.get("status") != "ok":
            return
        artifacts = d.get("artifacts") or {}
        run_card_path = artifacts.get("run_card_json")
        if not run_card_path or not Path(run_card_path).exists():
            return
        run_card = json.loads(Path(run_card_path).read_text(encoding="utf-8"))
        metrics = run_card.get("metrics") or {}
        cfg = run_card.get("backtest") or {}
        codes = cfg.get("codes") or []
        run_dir = args.get("run_dir") or ""

        equity: Dict[str, Any] = {}
        equity_path = artifacts.get("equity")
        if equity_path and Path(equity_path).exists():
            import pandas as pd
            eq = pd.read_csv(equity_path)
            equity = {
                "dates": eq["timestamp"].astype(str).tolist() if "timestamp" in eq else [],
                "equity": eq["equity"].tolist() if "equity" in eq else [],
                "drawdown": eq["drawdown"].tolist() if "drawdown" in eq else [],
            }
            if equity.get("dates") and equity.get("equity"):
                self.chart = {
                    "longName": ", ".join(codes) or None, "currency": None, "sector": None,
                    "dates": equity["dates"][-90:], "close": equity["equity"][-90:],
                }

        # The UI's candlestick "Chart" tab needs open/high/low/close/volume per
        # bar — equity.csv doesn't carry those (it's the equity curve, not
        # price), but the engine separately writes artifacts/ohlcv_<code>.csv
        # with exactly this shape. Join it onto equity["dates"] by date so a
        # length mismatch between the two files never misaligns bars.
        # Build this for EVERY requested code, not just codes[0] — a portfolio
        # backtest (multiple codes) needs a candlestick per asset, keyed under
        # equity["bySymbol"], mirroring Vibe-Trading's symbol-keyed price_series.
        if codes and equity.get("dates"):
            equity["bySymbol"] = {}
            for code in codes:
                ohlcv_path = Path(run_dir) / "artifacts" / f"ohlcv_{code}.csv"
                if not ohlcv_path.exists():
                    continue
                try:
                    import pandas as pd
                    ohlcv = pd.read_csv(ohlcv_path)
                    ohlcv["trade_date"] = ohlcv["trade_date"].astype(str).str.slice(0, 10)
                    by_date = ohlcv.drop_duplicates("trade_date").set_index("trade_date")
                    cols = {"open": [], "high": [], "low": [], "close": [], "volume": []}
                    for dt in equity["dates"]:
                        row = by_date.loc[str(dt)[:10]] if str(dt)[:10] in by_date.index else None
                        for col in cols:
                            cols[col].append(float(row[col]) if row is not None else None)
                    equity["bySymbol"][code] = cols
                except Exception:  # noqa: BLE001 — chart enrichment is best-effort
                    logger.exception("ohlcv enrichment failed for %s", ohlcv_path)
            # codes[0]'s series also stays at the top level for back-compat
            # with any consumer still reading equity.open/high/low/close directly.
            if codes[0] in equity["bySymbol"]:
                equity.update(equity["bySymbol"][codes[0]])

        trades: List[Dict[str, Any]] = []
        trades_path = artifacts.get("trades")
        if trades_path and Path(trades_path).exists():
            import pandas as pd
            trades = _pair_trades(pd.read_csv(trades_path).to_dict("records"))

        code_path = Path(run_dir) / "code" / "signal_engine.py"
        generated_code = code_path.read_text(encoding="utf-8") if code_path.exists() else ""

        for src in run_card.get("data_sources") or []:
            if src not in self.data_sources:
                self.data_sources.append(src)

        self.backtest = {
            "ticker": codes[0] if codes else None,
            "runId": f"{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}_{self.task_id[:6]}",
            "strategyName": "Custom Strategy",
            "strategyExplanation": "",
            "generatedCode": generated_code,
            "codeAttempts": 1,
            "metrics": metrics,
            "equity": equity,
            "trades": trades,
            "runCard": {
                "codes": codes, "start_date": cfg.get("start_date"), "end_date": cfg.get("end_date"),
                "source": ", ".join(run_card.get("data_sources") or []),
                "interval": cfg.get("interval"), "initial_cash": cfg.get("initial_cash"),
                "period_start": cfg.get("start_date"), "period_end": cfg.get("end_date"),
                "bars": len(equity.get("dates") or []),
            },
        }


_WORKSPACE_PATH_TOOLS = {"write_file", "read_file", "edit_file"}


def _split_run_dir_path(path: str, last_run_dir: Optional[str]) -> tuple:
    """write_file/read_file/edit_file's JSON schema declares only a bare
    `path` — no `run_dir` parameter, unlike `backtest` — but all three DO
    accept an optional `run_dir` kwarg in their actual execute() signature
    (just not exposed to the model). Rather than hope the model always folds
    the run_dir into `path` correctly (confirmed unreliable in production:
    repeated "File not found or path escapes workspace" on bare filenames
    like "artifacts/trades.csv" — worse, write_file's and read_file's own
    path-resolution helpers disagree on what a bare "runs/<id>/..." path even
    means when no run_dir kwarg is given, one cwd-relative, one root-joined),
    inject run_dir out of band and pass a bare relative path — the one shape
    every one of these tools' with-run_dir code path resolves consistently.

    Returns (run_dir_to_use, relative_path_to_use). If the model's `path`
    already starts with "runs/<id>/...", that establishes the run for this
    and future calls; otherwise falls back to the last known run_dir and
    passes `path` through untouched (already relative).
    """
    p = path.lstrip("/") if isinstance(path, str) else ""
    if p.startswith("runs/"):
        parts = p.split("/", 2)
        if len(parts) == 3:
            return f"runs/{parts[1]}", parts[2]
        if len(parts) == 2:
            return f"runs/{parts[1]}", ""
    return last_run_dir, path


# Filenames that don't exist in any backtest run and never will — the model
# guesses these repeatedly despite the system prompt saying not to (confirmed
# in production, on the very first tool call of a brand-new task with no
# history to explain it). A hard, code-level redirect is more reliable than
# hoping prose sticks: it fires exactly when the mistake happens.
_KNOWN_NONEXISTENT_ARTIFACT_NAMES = ("metrics.json", "summary.json", "results.json", "report.json")


def _read_file_guard(args: Dict[str, Any]) -> Optional[str]:
    """Short-circuit a read_file call doomed to fail, with an actionable
    message instead of a generic "not found" — called after run_dir splitting,
    so `args["run_dir"]` reflects whatever _split_run_dir_path resolved."""
    path = str(args.get("path") or "")
    if path.endswith(_KNOWN_NONEXISTENT_ARTIFACT_NAMES):
        name = path.rsplit("/", 1)[-1]
        return json.dumps({
            "status": "error",
            "error": (f"There is no {name} file — it does not exist in any backtest run. Metrics "
                      "are already in the `backtest` tool's own response as a top-level `metrics` "
                      "object; use that directly, no file read needed. (Individual trade rows, if "
                      "truly needed, are at artifacts/trades.csv — nothing else.)"),
        }, ensure_ascii=False)
    if not args.get("run_dir"):
        return json.dumps({
            "status": "error",
            "error": ("Nothing has been written yet in this task — this is a brand-new, empty "
                      "environment (even if earlier turns in this conversation mention a run, "
                      "none of those files exist here). Call write_file to create config.json "
                      "and code/signal_engine.py, then backtest, before reading anything."),
        }, ensure_ascii=False)
    return None


def _enrich_backtest_result(raw_result: str) -> str:
    """backtest_tool.py's own envelope buries the metrics as a JSON STRING
    nested inside `stdout` — the model has to parse the outer envelope, then
    recognize `stdout` is itself JSON, then parse THAT to get real numbers.
    Confirmed in production: this doubly-nested shape was exactly why the
    agent kept guessing at artifact filenames (metrics.json, summary.json —
    neither exists) and re-running backtests instead of trusting a result it
    already had. Hoist metrics/data sources to clean top-level fields sourced
    from the authoritative run_card.json on disk (which stdout is truncated-
    to-2000-chars of, and could theoretically clip on a very chatty engine
    run) so the model can use them with zero parsing gymnastics."""
    try:
        d = json.loads(raw_result)
    except Exception:
        return raw_result
    if d.get("status") != "ok":
        return raw_result
    run_card_path = (d.get("artifacts") or {}).get("run_card_json")
    if not run_card_path or not Path(run_card_path).exists():
        return raw_result
    try:
        run_card = json.loads(Path(run_card_path).read_text(encoding="utf-8"))
    except Exception:
        return raw_result
    d["metrics"] = run_card.get("metrics") or {}
    d["dataSources"] = run_card.get("data_sources") or []
    d.pop("stdout", None)  # superseded by the clean `metrics` field above
    return json.dumps(d, ensure_ascii=False)


def _pair_trades(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """backtest/metrics.py's trades.csv is one row per fill (buy/sell/
    end_of_backtest); pair them into round-trip trades matching our UI's
    entry/exit shape. The exit row already carries return_pct/holding_days
    computed relative to its paired entry (their own Layer-1 attribution
    convention: exit rows have pnl != 0, entry rows have pnl == 0)."""
    open_by_code: Dict[str, Dict[str, Any]] = {}
    paired: List[Dict[str, Any]] = []
    for row in rows:
        code = row.get("code")
        if row.get("side") == "buy":
            open_by_code[code] = row
            continue
        entry = open_by_code.pop(code, None)
        paired.append({
            "entry_date": entry.get("timestamp") if entry else None,
            "exit_date": row.get("timestamp"),
            "entry_price": entry.get("price") if entry else None,
            "exit_price": row.get("price"),
            "return_pct": row.get("return_pct"),
            "holding_days": int(row.get("holding_days") or 0),
            "open": False,
        })
    for code, entry in open_by_code.items():
        paired.append({"entry_date": entry.get("timestamp"), "exit_date": None,
                       "entry_price": entry.get("price"), "exit_price": None,
                       "return_pct": None, "holding_days": None, "open": True})
    return paired


def run(api: ApiClient, prompt: str) -> Dict[str, Any]:
    """Run the ReAct loop and return the payload for /sandbox/result."""
    try:
        skills = SkillsLoader()
    except Exception as exc:  # noqa: BLE001 — skills are an enhancement, never fatal
        logger.warning("skills failed to load: %s", exc)
        skills = None
    try:
        registry = build_vt_registry()
    except Exception as exc:  # noqa: BLE001
        logger.warning("tool discovery failed: %s", exc)
        registry = None

    state = _RunState(api.task_id)
    skills_block = skills.get_descriptions() if skills and skills.skills else "(none)"
    tools_block = _tools_block(registry)

    context = api.get_context()
    if context:
        api.progress("Reading conversation", "done", f"{len(context)} earlier turn(s)")

    messages: List[Dict[str, Any]] = [
        {"role": "system", "content": _system_prompt(skills_block, tools_block)}]
    messages.extend(_build_history(context))
    messages.append({"role": "user", "content": prompt})

    tool_defs = registry.get_definitions() if registry else []
    final = ""
    # Ported from Vibe-Trading's agent/src/agent/loop.py: a one-time nudge at
    # 80% of the budget telling the model how many iterations are left, so it
    # can wrap up with partial results on its own terms instead of being cut
    # off mid-task at the hard `is_last` boundary below.
    wrap_up_at = max(1, int(MAX_ITERS * 0.8))
    for iteration in range(1, MAX_ITERS + 1):
        is_last = iteration == MAX_ITERS
        if iteration == wrap_up_at and 1 < iteration < MAX_ITERS:
            remaining = MAX_ITERS - iteration
            messages.append({"role": "user", "content": (
                f"[SYSTEM] You have {remaining} iterations remaining out of {MAX_ITERS}. "
                "Please wrap up your work. Stop calling tools and provide your final answer "
                "as plain text. If you have partial results, summarize what you have so far."
            )})
        # Re-evaluated every iteration against real token pressure (their
        # scheme), not a fixed "N rounds old" schedule.
        _compact_messages(messages)
        api.progress("Thinking")
        resp = api.chat(messages, tools=None if is_last else tool_defs)
        tool_calls = resp.get("toolCalls") or []
        api.progress("Thinking", "done")

        if not tool_calls:
            final = (resp.get("content") or "").strip()
            break

        # Append the assistant turn verbatim (preserves tool_calls + provider fields
        # the proxy needs on the next round), then run each tool and feed results back.
        raw = resp.get("rawMessage") or {"role": "assistant", "content": resp.get("content") or "",
                                         "tool_calls": []}
        messages.append(raw)
        for tc in tool_calls:
            name = tc.get("name") or ""
            args = dict(tc.get("args") or {})
            if name in _WORKSPACE_PATH_TOOLS:
                run_dir, rel_path = _split_run_dir_path(args.get("path", ""), state.last_run_dir)
                if run_dir:
                    args["run_dir"] = run_dir
                    args["path"] = rel_path or args.get("path", "")
            label = _PROGRESS_LABELS.get(name, name.replace("_", " ").title())
            hint = (args.get("query") or args.get("symbol") or args.get("url")
                    or args.get("name") or args.get("run_dir") or args.get("path") or "")
            api.progress(label, "running", str(hint)[:120])
            guard_result = _read_file_guard(args) if name == "read_file" else None
            if guard_result is not None:
                result = guard_result
            else:
                result = registry.execute(name, args) if registry else json.dumps(
                    {"status": "error", "error": "tool registry unavailable"})
                if name == "backtest":
                    result = _enrich_backtest_result(result)
            state.ingest(name, args, result)
            api.progress(label, "done", _detail(name, result))
            messages.append({"role": "tool", "tool_call_id": tc.get("id"),
                             "name": name, "content": result[:_MAX_TOOL_RESULT_CHARS]})

    if not final:
        final = ("I reached the step limit before fully finishing. Here is what I gathered; "
                 "ask me to continue and I'll pick up from here.")

    api.progress("Writing answer", "done")

    payload: Dict[str, Any] = {
        "status": "COMPLETED",
        "intent": "backtest" if state.backtest else "research",
        "content": final,
        "sources": state.sources[:12],
        "dataSource": ", ".join(state.data_sources) or None,
        "skillsUsed": state.skills_used[:12],
    }
    if state.chart:
        payload["chartData"] = state.chart
        payload.setdefault("ticker", None)
    if state.backtest:
        bt = state.backtest
        payload.update({
            "ticker": bt["ticker"], "runId": bt["runId"],
            "strategyName": bt["strategyName"], "strategyExplanation": bt["strategyExplanation"],
            "generatedCode": bt["generatedCode"], "codeAttempts": bt["codeAttempts"],
            "metrics": bt["metrics"], "equity": bt["equity"], "trades": bt["trades"],
            "runCard": bt["runCard"],
        })
    return payload
