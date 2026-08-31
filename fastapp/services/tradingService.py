import contextvars
import os
import json
import logging
import math
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional

logger = logging.getLogger(__name__)

# Horizon presets: yfinance history period to fetch per prediction horizon
HORIZON_CONFIG = {
    "7d": {"period": "3mo", "label": "7 days"},
    "30d": {"period": "1y", "label": "30 days"},
    "90d": {"period": "2y", "label": "90 days"},
}



def yahoo_symbol_search(query: str, limit: int = 5) -> List[str]:
    """
    Symbol search via Yahoo's v1 finance search endpoint — a direct copy of
    Vibe-Trading's yahoo_client.search() used by its search_symbol tool.
    Returns candidate symbols, best match first. Failures return [] (a failing
    source never aborts the chain).
    """
    import requests
    try:
        r = requests.get(
            "https://query2.finance.yahoo.com/v1/finance/search",
            params={"q": query},
            headers={"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"},
            timeout=10,
        )
        quotes = (r.json() or {}).get("quotes") or []
        return [q["symbol"] for q in quotes[:limit] if isinstance(q, dict) and q.get("symbol")]
    except Exception as e:
        logger.warning(f"[Trading] Yahoo symbol search failed for {query!r}: {e}")
        return []


def _normalize_symbol(sym: str) -> str:
    """Static symbol guards mirroring Vibe-Trading's loader symbol mapping:
    USDT/USDC crypto pairs are quoted as -USD on Yahoo; .US suffix is stripped."""
    s = sym.strip().upper()
    if s.endswith(".US"):
        s = s[:-3]
    for stable in ("-USDT", "-USDC"):
        if s.endswith(stable):
            s = s[: -len(stable)] + "-USD"
    if s.endswith("USDT") and "-" not in s:  # e.g. BTCUSDT
        s = s[:-4] + "-USD"
    return s



def fetch_market_data(ticker: str, horizon: str, start: Optional[str] = None, end: Optional[str] = None) -> Dict[str, Any]:
    """
    Data layer (Vibe-Trading style): fetch OHLCV history via yfinance with an
    integrity guard (high >= low, positive prices) at the loader boundary.
    Returns a dict of cleaned lists ready for indicator computation.
    When start/end are given (backtest mode) they take precedence over horizon.
    """
    import yfinance as yf

    period = HORIZON_CONFIG.get(horizon, HORIZON_CONFIG["30d"])["period"]
    tk = yf.Ticker(ticker)
    if start:
        hist = tk.history(start=start, end=end or None, auto_adjust=True)
    else:
        hist = tk.history(period=period, auto_adjust=True)
    if hist is None or hist.empty or len(hist) < 20:
        raise ValueError(f"No sufficient market data found for ticker '{ticker}'. Verify the symbol (e.g. AAPL, MSFT, ^GSPC, BTC-USD).")

    # OHLC integrity guard
    hist = hist[(hist["High"] >= hist["Low"]) & (hist["Close"] > 0) & (hist["Open"] > 0)]
    if len(hist) < 20:
        raise ValueError(f"Market data for '{ticker}' failed integrity checks.")

    info = {}
    try:
        info = tk.info or {}
    except Exception:
        pass  # info endpoint is flaky; the prediction works from OHLCV alone

    return {
        "dates": [d.strftime("%Y-%m-%d") for d in hist.index],
        "open": [round(float(v), 4) for v in hist["Open"].tolist()],
        "high": [round(float(v), 4) for v in hist["High"].tolist()],
        "low": [round(float(v), 4) for v in hist["Low"].tolist()],
        "close": [round(float(v), 4) for v in hist["Close"].tolist()],
        "volume": [int(v) for v in hist["Volume"].fillna(0).tolist()],
        "longName": info.get("longName") or info.get("shortName") or ticker.upper(),
        "currency": info.get("currency") or "USD",
        "sector": info.get("sector"),
        "marketCap": info.get("marketCap"),
    }


def _sma(values: List[float], window: int) -> Optional[float]:
    if len(values) < window:
        return None
    return sum(values[-window:]) / window


def _rsi(closes: List[float], period: int = 14) -> Optional[float]:
    if len(closes) < period + 1:
        return None
    gains, losses = [], []
    for i in range(-period, 0):
        delta = closes[i] - closes[i - 1]
        gains.append(max(delta, 0.0))
        losses.append(max(-delta, 0.0))
    avg_gain = sum(gains) / period
    avg_loss = sum(losses) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100.0 - (100.0 / (1.0 + rs))


def _ema(values: List[float], window: int) -> Optional[float]:
    if len(values) < window:
        return None
    k = 2.0 / (window + 1)
    ema = sum(values[:window]) / window
    for v in values[window:]:
        ema = v * k + ema * (1 - k)
    return ema


def compute_signals(data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Signal engine (Vibe-Trading style, dependency-light): classic technical
    indicators computed from the cleaned OHLCV series.
    """
    closes = data["close"]
    last = closes[-1]
    sma20 = _sma(closes, 20)
    sma50 = _sma(closes, 50)
    ema12 = _ema(closes, 12)
    ema26 = _ema(closes, 26)
    macd = (ema12 - ema26) if (ema12 is not None and ema26 is not None) else None
    rsi14 = _rsi(closes, 14)

    # Annualized volatility from daily log returns
    rets = [math.log(closes[i] / closes[i - 1]) for i in range(1, len(closes)) if closes[i - 1] > 0]
    vol_annual = None
    if len(rets) >= 20:
        mean = sum(rets) / len(rets)
        var = sum((r - mean) ** 2 for r in rets) / (len(rets) - 1)
        vol_annual = math.sqrt(var) * math.sqrt(252)

    def pct(cur, ref):
        return round((cur - ref) / ref * 100.0, 2) if ref else None

    high_52w = max(data["high"])
    low_52w = min(data["low"])
    momentum_20d = pct(last, closes[-21]) if len(closes) > 21 else None
    momentum_60d = pct(last, closes[-61]) if len(closes) > 61 else None
    avg_volume_20 = _sma([float(v) for v in data["volume"]], 20)

    return {
        "lastClose": round(last, 4),
        "sma20": round(sma20, 4) if sma20 else None,
        "sma50": round(sma50, 4) if sma50 else None,
        "priceVsSma20Pct": pct(last, sma20),
        "priceVsSma50Pct": pct(last, sma50),
        "rsi14": round(rsi14, 2) if rsi14 is not None else None,
        "macd": round(macd, 4) if macd is not None else None,
        "annualVolatilityPct": round(vol_annual * 100, 2) if vol_annual else None,
        "momentum20dPct": momentum_20d,
        "momentum60dPct": momentum_60d,
        "high52w": round(high_52w, 4),
        "low52w": round(low_52w, 4),
        "distFromHigh52wPct": pct(last, high_52w),
        "avgVolume20d": int(avg_volume_20) if avg_volume_20 else None,
    }





def _rank(values: List[float]) -> List[float]:
    """Average-tie ranks, so Spearman = Pearson on ranks (no scipy dependency)."""
    order = sorted(range(len(values)), key=lambda i: values[i])
    ranks = [0.0] * len(values)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and values[order[j + 1]] == values[order[i]]:
            j += 1
        avg = (i + j) / 2.0 + 1.0
        for k in range(i, j + 1):
            ranks[order[k]] = avg
        i = j + 1
    return ranks


def _pearson(xs: List[float], ys: List[float]) -> float:
    n = len(xs)
    if n < 2:
        return 0.0
    mx, my = sum(xs) / n, sum(ys) / n
    cov = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    vx = math.sqrt(sum((x - mx) ** 2 for x in xs))
    vy = math.sqrt(sum((y - my) ** 2 for y in ys))
    if vx < 1e-12 or vy < 1e-12:
        return 0.0
    return cov / (vx * vy)


def compute_correlation_matrix(symbols: List[str], window: int = 90,
                               method: str = "pearson") -> Dict[str, Any]:
    """
    Resolve each symbol, fetch daily closes, align returns, and return
    {labels, matrix, window, method, observations}.
    """
    if len(symbols) < 2:
        raise ValueError("Provide at least two assets to correlate.")
    if len(symbols) > 12:
        raise ValueError("Provide at most 12 assets.")

    period = "2y" if window > 250 else "1y"
    closes: Dict[str, Dict[str, float]] = {}
    resolved: Dict[str, str] = {}
    errors: List[str] = []

    for raw in symbols:
        query = raw.strip()
        if not query:
            continue
        sym = _normalize_symbol(query)
        data = None
        for candidate in [sym] + yahoo_symbol_search(query, limit=3):
            try:
                data = fetch_market_data(_normalize_symbol(candidate), "90d" if period == "1y" else "90d")
                resolved[query] = _normalize_symbol(candidate)
                break
            except Exception:
                continue
        if data is None:
            errors.append(query)
            continue
        label = resolved[query]
        closes[label] = dict(zip(data["dates"], data["close"]))

    if len(closes) < 2:
        raise ValueError(
            "Could not resolve at least two assets"
            + (f" (failed: {', '.join(errors)})" if errors else "")
        )

    labels = sorted(closes.keys())
    # Inner-join on dates present for every asset
    common = set(closes[labels[0]].keys())
    for lab in labels[1:]:
        common &= set(closes[lab].keys())
    dates = sorted(common)
    if len(dates) < 3:
        raise ValueError("No overlapping trading days between the selected assets.")

    returns: Dict[str, List[float]] = {}
    for lab in labels:
        series = [closes[lab][d] for d in dates]
        returns[lab] = [
            (series[i] / series[i - 1] - 1.0) if series[i - 1] else 0.0
            for i in range(1, len(series))
        ]

    # Trailing window
    for lab in labels:
        if len(returns[lab]) > window:
            returns[lab] = returns[lab][-window:]
    n_obs = len(returns[labels[0]])
    if n_obs < 2:
        raise ValueError("Not enough overlapping observations to compute correlation.")

    prepared = {lab: (_rank(returns[lab]) if method == "spearman" else returns[lab]) for lab in labels}

    size = len(labels)
    matrix = [[1.0] * size for _ in range(size)]
    for i in range(size):
        for j in range(i + 1, size):
            corr = _pearson(prepared[labels[i]], prepared[labels[j]])
            if not math.isfinite(corr):
                corr = 0.0
            matrix[i][j] = matrix[j][i] = round(corr, 4)

    return {
        "labels": labels,
        "matrix": matrix,
        "window": window,
        "method": method,
        "observations": n_obs,
        "periodStart": dates[1] if len(dates) > 1 else dates[0],
        "periodEnd": dates[-1],
        "unresolved": errors,
    }
