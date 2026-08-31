/**
 * Trading Studio — a clone of the Vibe-Trading web UI (github.com/HKUDS/Vibe-Trading, MIT)
 * adapted into Bihand.
 *
 * Layout mirrors theirs: a left rail (Agent / Reports + Sessions list), a chat
 * Agent view where the model writes and runs a real signal_engine.py, a Backtest
 * Report Library, and a Run Detail page with Chart / Trades / Run Card / Code tabs.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Bot, FileText, Plus, Send, Loader2, AlertTriangle, Coins, User, MessageSquare,
  BarChart3, Code2, ListOrdered, ArrowLeft, RefreshCw, Search, CheckCircle2,
  TrendingUp, TrendingDown, Minus, Download, Grid3x3,
  Database, Globe, BookOpen,
} from 'lucide-react';
import api from '../lib/api';
import {
  MetricsCard, MiniEquityChart, CandleChart, EquityDrawdownChart,
  ThinkingTimeline, AgentAvatar, type AgentStep, type Marker,
} from '../components/trading/TradingParts';
import {
  ACCENT, METRIC_ORDER, METRIC_LABELS, formatMetric, metricSentiment,
} from '../components/trading/tradingFormat';

/* ------------------------------- types ------------------------------- */

interface PredictionResult {
  signal: 'BUY' | 'HOLD' | 'SELL'; confidence: number; targetLow: number; targetHigh: number;
  summary: string; bullCase: string; bearCase: string; keyRisks: string[];
  technicalReadout: string; disclaimer: string;
}
interface SignalCard {
  lastClose: number; sma20?: number | null; sma50?: number | null; rsi14?: number | null;
  macd?: number | null; annualVolatilityPct?: number | null; momentum20dPct?: number | null;
  high52w?: number | null; low52w?: number | null; distFromHigh52wPct?: number | null; avgVolume20d?: number | null;
}
interface Trade {
  entry_date: string; exit_date: string; entry_price: number; exit_price: number;
  return_pct: number; holding_days: number; open: boolean;
}
interface EquityArtifact {
  dates: string[]; equity: number[]; drawdown: number[]; close: number[];
  open: number[]; high: number[]; low: number[]; volume: number[]; signal: number[];
  // Per-asset OHLCV for portfolio/multi-symbol backtests, keyed by ticker
  // (codes[0]'s series is also mirrored onto the fields above for back-compat).
  bySymbol?: Record<string, { open: number[]; high: number[]; low: number[]; close: number[]; volume: number[] }>;
}
interface RunCard {
  codes: string[]; start_date: string; end_date: string; source: string; interval: string;
  initial_cash: number; bars: number; bars_per_year: number; period_start: string; period_end: string;
}
interface WebSource { title: string; url: string; }
interface Turn {
  _id: string; prompt: string; sessionId?: string | null;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  failureReason?: string | null; cost: number;
  intent?: 'research' | 'backtest' | null; ticker?: string | null; horizon?: string | null;
  dataSource?: string | null; sources?: WebSource[] | null;
  skillsUsed?: string[] | null;  // methodology skills the agent loaded
  content?: string | null;  // the agent's free-form markdown answer
  steps?: AgentStep[];
  result?: PredictionResult | null; signals?: SignalCard | null;
  runId?: string | null; strategyName?: string | null; strategyExplanation?: string | null;
  generatedCode?: string | null; codeAttempts?: number | null;
  metrics?: Record<string, number | null> | null;
  equity?: EquityArtifact | null; trades?: Trade[] | null; runCard?: RunCard | null;
  analysis?: string | null;
  billing?: {
    inputTokens: number; outputTokens: number; llmCalls: number;
    costUsd: number; credits: number; heldCredits: number;
    chargedCredits: number; refundedCredits: number;
  } | null;
  chartData?: { dates?: string[]; close?: number[]; longName?: string; currency?: string; sector?: string } | null;
  createdAt: string;
}

interface SessionRow {
  sessionId: string; title: string; createdAt: string; lastActivity: string;
  turns: number; lastStatus: Turn['status'];
}


const EXAMPLES = [
  { title: 'RSI mean-reversion', desc: 'Generate + backtest an oversold/overbought rule', prompt: 'Backtest an RSI mean-reversion strategy on BTC-USD for the last 6 months: buy when RSI(14) < 30, sell when RSI > 70' },
  { title: 'Dual moving-average', desc: 'Classic golden-cross trend following', prompt: 'Create a dual moving average crossover strategy for AAPL and backtest it from 2026-01-01 to 2026-06-30' },
  { title: 'MACD momentum', desc: 'Signal-line crossover with a trend filter', prompt: 'Backtest a MACD crossover strategy on Tesla over the past 6 months' },
  { title: 'Research a stock', desc: 'Signal card + bull/bear thesis, no backtest', prompt: 'Is Tesla overbought right now?' },
  { title: 'Crypto outlook', desc: 'Natural-language market question', prompt: 'Will Bitcoin go up next month?' },
  { title: 'Vietnamese equities', desc: 'Ask in any language', prompt: 'Phân tích cổ phiếu Vinamilk' },
];

const MD_COMPONENTS = {
  p: (p: React.ComponentPropsWithoutRef<'p'>) => <p className="leading-relaxed mb-3 last:mb-0 text-foreground" {...p} />,
  strong: (p: React.ComponentPropsWithoutRef<'strong'>) => <strong className="text-foreground font-semibold" {...p} />,
  ul: (p: React.ComponentPropsWithoutRef<'ul'>) => <ul className="list-disc ps-5 space-y-1 mb-3 text-foreground" {...p} />,
  ol: (p: React.ComponentPropsWithoutRef<'ol'>) => <ol className="list-decimal ps-5 space-y-1 mb-3 text-foreground" {...p} />,
  h1: (p: React.ComponentPropsWithoutRef<'h1'>) => <h2 className="text-xl font-bold text-foreground mt-5 mb-2" {...p} />,
  h2: (p: React.ComponentPropsWithoutRef<'h2'>) => <h2 className="text-lg font-bold text-foreground mt-5 mb-2" {...p} />,
  h3: (p: React.ComponentPropsWithoutRef<'h3'>) => <h3 className="text-base font-semibold text-foreground mt-4 mb-1.5" {...p} />,
  table: (p: React.ComponentPropsWithoutRef<'table'>) => <div className="overflow-x-auto mb-3"><table className="w-full text-sm border-collapse" {...p} /></div>,
  th: (p: React.ComponentPropsWithoutRef<'th'>) => <th className="text-left font-semibold text-foreground border border-border bg-background px-3 py-1.5" {...p} />,
  td: (p: React.ComponentPropsWithoutRef<'td'>) => <td className="border border-border px-3 py-1.5 text-foreground" {...p} />,
  code: (p: React.ComponentPropsWithoutRef<'code'>) => <code className="bg-secondary border border-border rounded px-1 py-0.5 text-[12px] font-mono text-foreground" {...p} />,
};

/* --------------------------- syntax highlight --------------------------- */

const KEYWORDS = /\b(import|from|as|class|def|return|if|elif|else|for|while|in|not|and|or|is|None|True|False|self|try|except|finally|with|pass|lambda|raise|continue|break)\b/g;

function highlightPython(src: string): React.ReactNode[] {
  return src.split('\n').map((line, i) => {
    const commentAt = line.indexOf('#');
    const code = commentAt >= 0 ? line.slice(0, commentAt) : line;
    const comment = commentAt >= 0 ? line.slice(commentAt) : '';
    const parts: React.ReactNode[] = [];
    // strings first so keywords inside them aren't highlighted
    const strRe = /(['"])(?:(?!\1)[^\\]|\\.)*\1/g;
    let last = 0;
    let m: RegExpExecArray | null;
    let key = 0;
    while ((m = strRe.exec(code)) !== null) {
      const before = code.slice(last, m.index);
      parts.push(<span key={`b${key++}`} dangerouslySetInnerHTML={{ __html: escapeKw(before) }} />);
      parts.push(<span key={`s${key++}`} className="text-emerald-400">{m[0]}</span>);
      last = m.index + m[0].length;
    }
    parts.push(<span key={`r${key++}`} dangerouslySetInnerHTML={{ __html: escapeKw(code.slice(last)) }} />);
    if (comment) parts.push(<span key={`c${key}`} className="text-muted-foreground">{comment}</span>);
    return <div key={i} className="whitespace-pre">{parts}</div>;
  });
}
function escapeKw(s: string): string {
  const esc = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc
    .replace(KEYWORDS, '<span style="color:#f472b6">$1</span>')
    .replace(/\b(\d+\.?\d*)\b/g, '<span style="color:#60a5fa">$1</span>');
}

/* ---------------------------- correlation heatmap ---------------------------- */

// Diverging RdBu ramp, same stops Vibe-Trading feeds ECharts' visualMap.
const CORR_STOPS = ['#2166ac', '#4393c3', '#92c5de', '#d1e5f0', '#f7f7f7', '#fddbc7', '#f4a582', '#d6604d', '#b2182b'];

function corrColor(v: number): string {
  const t = Math.min(1, Math.max(0, (v + 1) / 2));          // -1..1 -> 0..1
  const pos = t * (CORR_STOPS.length - 1);
  const i = Math.min(CORR_STOPS.length - 2, Math.floor(pos));
  const f = pos - i;
  const hex = (c: string) => [1, 3, 5].map(k => parseInt(c.slice(k, k + 2), 16));
  const [r1, g1, b1] = hex(CORR_STOPS[i]);
  const [r2, g2, b2] = hex(CORR_STOPS[i + 1]);
  const mix = (a: number, b: number) => Math.round(a + (b - a) * f);
  return `rgb(${mix(r1, r2)}, ${mix(g1, g2)}, ${mix(b1, b2)})`;
}

const CorrelationHeatmap: React.FC<{
  data: { labels: string[]; matrix: number[][]; observations: number; periodStart: string; periodEnd: string };
}> = ({ data }) => {
  const { labels, matrix } = data;
  return (
    <div className="rounded-xl border border-border bg-card p-4" data-testid="correlation-matrix">
      <div className="flex items-center justify-between mb-3 text-xs text-muted-foreground">
        <span>{data.observations} overlapping sessions · {data.periodStart} → {data.periodEnd}</span>
        <span className="flex items-center gap-1.5">
          −1
          <span className="inline-block h-2.5 w-28 rounded"
                style={{ background: `linear-gradient(to right, ${CORR_STOPS.join(',')})` }} />
          +1
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="border-collapse">
          <thead>
            <tr>
              <th className="p-1" />
              {labels.map(l => (
                <th key={l} className="p-1 text-[11px] font-medium text-muted-foreground font-mono whitespace-nowrap">{l}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {labels.map((rowLabel, i) => (
              <tr key={rowLabel}>
                <td className="p-1 pe-2 text-[11px] font-medium text-muted-foreground font-mono text-right whitespace-nowrap">{rowLabel}</td>
                {labels.map((colLabel, j) => {
                  const v = matrix[i][j];
                  return (
                    <td key={colLabel} className="p-0.5">
                      <div className="h-11 w-16 rounded flex items-center justify-center text-[11px] font-mono font-semibold"
                           style={{ background: corrColor(v), color: Math.abs(v) > 0.55 ? '#fff' : '#18181b' }}
                           title={`${rowLabel} / ${colLabel}: ${v.toFixed(4)}`}>
                        {v.toFixed(2)}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

/* ----------------------------- run complete ----------------------------- */

const RunCompleteCard: React.FC<{ turn: Turn; onOpenRun: (t: Turn) => void }> = ({ turn, onOpenRun }) => {
  if (!turn.metrics) return null;
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <MetricsCard metrics={turn.metrics} compact />
      {turn.equity && <MiniEquityChart values={turn.equity.equity} />}
      <button onClick={() => onOpenRun(turn)} className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium hover:underline" style={{ color: ACCENT }}>
        <BarChart3 size={14} /> Full Report →
      </button>
    </div>
  );
};

/* ------------------------------ assistant ------------------------------ */

const SignalBadge: React.FC<{ signal: string }> = ({ signal }) => {
  const cfg = signal === 'BUY' ? { c: 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10', I: TrendingUp }
    : signal === 'SELL' ? { c: 'text-red-400 border-red-500/40 bg-red-500/10', I: TrendingDown }
    : { c: 'text-amber-400 border-amber-500/40 bg-amber-500/10', I: Minus };
  const I = cfg.I;
  return <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-sm font-bold shrink-0 ${cfg.c}`}><I size={16} /> {signal}</span>;
};

const AssistantTurn: React.FC<{ turn: Turn; onOpenRun: (t: Turn) => void }> = ({ turn, onOpenRun }) => {
  const running = turn.status === 'PENDING' || turn.status === 'PROCESSING';

  return (
    <div className="space-y-3">
      {turn.steps && turn.steps.length > 0 && <ThinkingTimeline steps={turn.steps} />}
      {running && (!turn.steps || turn.steps.length === 0) && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={15} className="animate-spin" style={{ color: ACCENT }} /> Queued…
        </div>
      )}

      {turn.status === 'FAILED' && (
        <div className="flex items-start gap-2 text-sm rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-red-400" />
          <div><p className="text-red-400 font-medium">Run failed — credits refunded</p>
            <p className="text-muted-foreground mt-0.5">{turn.failureReason}</p></div>
        </div>
      )}

      {turn.status === 'COMPLETED' && turn.billing && (
        <p className="text-[11px] text-muted-foreground" data-testid="turn-billing">
          Billed {turn.billing.chargedCredits.toFixed(2)} credits
          · {(turn.billing.inputTokens + turn.billing.outputTokens).toLocaleString()} tokens
          across {turn.billing.llmCalls} model call{turn.billing.llmCalls === 1 ? '' : 's'}
          {turn.billing.refundedCredits > 0 && ` · ${turn.billing.refundedCredits.toFixed(2)} refunded`}
        </p>
      )}

      {turn.status === 'COMPLETED' && (
        <div className="space-y-3">
          {/* Backtest artifacts, when a backtest ran this turn (Report card + strategy header). */}
          {(turn.runCard || turn.metrics) && (
            <>
              {(turn.strategyName || turn.strategyExplanation) && (
                <div className="text-sm">
                  <span className="font-semibold text-foreground">{turn.strategyName}</span>
                  <span className="text-muted-foreground"> · {turn.ticker} · {turn.runCard?.period_start} → {turn.runCard?.period_end}</span>
                  {(turn.codeAttempts ?? 1) > 1 && <span className="text-amber-600"> · self-repaired after {turn.codeAttempts} attempts</span>}
                  {turn.strategyExplanation && <p className="text-muted-foreground mt-1 leading-relaxed">{turn.strategyExplanation}</p>}
                </div>
              )}
              <RunCompleteCard turn={turn} onOpenRun={onOpenRun} />
            </>
          )}

          {/* Price sparkline + resolved data source, when we fetched market data. */}
          {turn.chartData?.close && turn.chartData.close.length > 1 && (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">{turn.chartData.longName || turn.ticker}</span>
                {turn.chartData.currency && <span>· {turn.chartData.currency}</span>}
                {turn.dataSource && <span className="inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-wide"><Database size={9} /> {turn.dataSource}</span>}
              </div>
              <MiniEquityChart values={turn.chartData.close} height={110} />
            </div>
          )}

          {/* The agent's free-form markdown answer — the primary output. */}
          {turn.content && (
            <div className="text-sm max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>{turn.content}</ReactMarkdown>
            </div>
          )}

          {/* Legacy structured card (pipeline-era turns that predate free-form content). */}
          {!turn.content && turn.result && (
            <>
              <div className="flex items-center gap-3">
                <SignalBadge signal={turn.result.signal} />
                <div className="text-center"><div className="text-lg font-bold text-foreground">{turn.result.confidence}%</div>
                  <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Confidence</div></div>
              </div>
              <p className="text-sm text-foreground leading-relaxed">{turn.result.summary}</p>
              <div><div className="font-semibold text-xs text-foreground mb-1.5">Technical Readout</div>
                <p className="text-[13px] text-foreground leading-relaxed">{turn.result.technicalReadout}</p></div>
              <p className="text-[11px] text-muted-foreground italic">{turn.result.disclaimer}</p>
            </>
          )}

          {/* Methodology skills the agent applied this turn. */}
          {turn.skillsUsed && turn.skillsUsed.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Skills applied:</span>
              {turn.skillsUsed.map(s => (
                <span key={s} className="inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  <BookOpen size={9} /> {s}
                </span>))}
            </div>
          )}

          {/* Web sources cited by the agent. */}
          {turn.sources && turn.sources.length > 0 && (
            <div className="border-t border-border pt-3">
              <div className="flex items-center gap-1.5 font-semibold text-xs text-foreground mb-1.5"><Globe size={13} className="text-sky-500" /> Web Sources</div>
              <ul className="space-y-1">{turn.sources.map((s, i) => (
                <li key={i} className="text-[12px] flex gap-1.5">
                  <span className="text-muted-foreground shrink-0">[{i + 1}]</span>
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline truncate" title={s.url}>{s.title || s.url}</a>
                </li>))}</ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/* ------------------------------ run detail ------------------------------ */

const RunDetailView: React.FC<{ turn: Turn; onBack: () => void }> = ({ turn, onBack }) => {
  const [tab, setTab] = useState<'chart' | 'trades' | 'card' | 'code'>('chart');
  const m = turn.metrics || {};
  const eq = turn.equity;

  // Multi-asset portfolio backtests carry a candlestick per code (eq.bySymbol);
  // fall back to the single ticker for older/single-symbol runs. runCard.codes
  // is NOT reliably an array — older stored runs have it as a stringified
  // repr (a pre-existing backend sanitizer bug), so eq.bySymbol is the
  // primary source of truth and runCard.codes is only used when it's a real array.
  const symbols = Array.isArray(turn.runCard?.codes) && turn.runCard.codes.length
    ? turn.runCard.codes
    : eq?.bySymbol ? Object.keys(eq.bySymbol) : turn.ticker ? [turn.ticker] : [];
  const [selectedSymbol, setSelectedSymbol] = useState<string>(symbols[0] || turn.ticker || '');
  const symbolSeries = eq?.bySymbol?.[selectedSymbol] || (eq && selectedSymbol === (symbols[0] || turn.ticker) ? eq : null);

  const markers: Marker[] = (turn.trades || []).flatMap(t => ([
    { date: t.entry_date, kind: 'B' as const, price: t.entry_price },
    ...(t.open ? [] : [{ date: t.exit_date, kind: 'S' as const, price: t.exit_price }]),
  ]));
  const candles = eq && symbolSeries ? eq.dates.map((d, i) => ({
    date: d, open: symbolSeries.open[i], high: symbolSeries.high[i], low: symbolSeries.low[i],
    close: symbolSeries.close[i], volume: symbolSeries.volume[i],
  })) : [];

  const downloadCsv = (name: string, rows: Record<string, unknown>[]) => {
    if (!rows.length) return;
    const cols = Object.keys(rows[0]);
    const csv = [cols.join(','), ...rows.map(r => cols.map(c => r[c]).join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="h-full overflow-auto bg-card">
      <div className="border-b border-border px-6 py-3 flex items-center gap-3">
        <button onClick={onBack} className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground" title="Go back"><ArrowLeft size={16} /></button>
        <CheckCircle2 size={17} className="text-emerald-400" />
        <h1 className="font-mono font-semibold text-foreground">{turn.runId || turn._id.slice(0, 16)}</h1>
        <span className="text-sm text-muted-foreground">{turn.strategyName}</span>
      </div>

      <div className="px-6 py-4 border-b border-border bg-background">
        <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-8 gap-y-3 gap-x-4">
          {METRIC_ORDER.filter(k => m[k] !== undefined && m[k] !== null).map(k => (
            <div key={k} className="text-center">
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium">{METRIC_LABELS[k]}</div>
              <div className={`text-sm font-bold font-mono tabular-nums mt-0.5 ${
                metricSentiment(k, m[k]) === 'positive' ? 'text-emerald-400'
                : metricSentiment(k, m[k]) === 'negative' ? 'text-red-400' : 'text-foreground'}`}>
                {formatMetric(k, m[k])}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="px-6 py-3 border-b border-border flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1">
          {([['chart', 'Chart', BarChart3], ['trades', 'Trades', ListOrdered], ['card', 'Run Card', FileText], ['code', 'Code', Code2]] as const).map(([k, label, Icon]) => (
            <button key={k} onClick={() => setTab(k)}
                    className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                      tab === k ? 'text-white' : 'text-muted-foreground hover:bg-secondary'}`}
                    style={tab === k ? { background: ACCENT } : undefined}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <button onClick={() => downloadCsv('trades.csv', (turn.trades || []) as unknown as Record<string, unknown>[])}
                  className="inline-flex items-center gap-1.5 hover:text-foreground"><Download size={14} /> Download Trades CSV</button>
          <button onClick={() => downloadCsv('metrics.csv', [m as Record<string, unknown>])}
                  className="inline-flex items-center gap-1.5 hover:text-foreground"><Download size={14} /> Download Metrics CSV</button>
        </div>
      </div>

      <div className="p-6">
        {tab === 'chart' && eq && (
          <div className="space-y-6">
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-foreground">{selectedSymbol}</h3>
                {symbols.length > 1 && (
                  <select
                    value={selectedSymbol}
                    onChange={(e) => setSelectedSymbol(e.target.value)}
                    className="bg-secondary text-foreground text-sm rounded-md px-2 py-1 border border-border focus:outline-none"
                    title="Switch asset"
                  >
                    {symbols.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                )}
              </div>
              <CandleChart candles={candles} markers={markers} />
            </div>
            <div><h3 className="font-semibold text-foreground mb-2">Equity &amp; Drawdown</h3>
              <EquityDrawdownChart dates={eq.dates} equity={eq.equity} drawdown={eq.drawdown} /></div>
          </div>
        )}

        {tab === 'trades' && (
          <table className="w-full text-sm">
            <thead><tr className="text-[10px] uppercase tracking-wide text-muted-foreground border-b border-border">
              {['#', 'Entry Date', 'Exit Date', 'Entry Px', 'Exit Px', 'Hold (d)', 'Return'].map(h => (
                <th key={h} className={`py-2 font-medium ${h === 'Return' || h.includes('Px') || h.includes('Hold') ? 'text-right' : 'text-left'}`}>{h}</th>))}
            </tr></thead>
            <tbody>
              {(turn.trades || []).map((t, i) => (
                <tr key={i} className="border-b border-border">
                  <td className="py-2 text-muted-foreground font-mono">{i + 1}</td>
                  <td className="py-2 text-foreground font-mono">{t.entry_date}</td>
                  <td className="py-2 text-foreground font-mono">{t.exit_date}{t.open ? ' (open)' : ''}</td>
                  <td className="py-2 text-right text-foreground font-mono">{t.entry_price?.toFixed(2)}</td>
                  <td className="py-2 text-right text-foreground font-mono">{t.exit_price?.toFixed(2)}</td>
                  <td className="py-2 text-right text-muted-foreground font-mono">{t.holding_days}</td>
                  <td className={`py-2 text-right font-mono font-semibold ${t.return_pct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {t.return_pct >= 0 ? '+' : ''}{t.return_pct}%</td>
                </tr>))}
              {(!turn.trades || turn.trades.length === 0) && (
                <tr><td colSpan={7} className="py-6 text-center text-muted-foreground">No trades were generated.</td></tr>)}
            </tbody>
          </table>
        )}

        {tab === 'card' && turn.runCard && (
          <div className="max-w-2xl">
            <table className="w-full text-sm">
              <tbody>
                {Object.entries(turn.runCard).map(([k, v]) => (
                  <tr key={k} className="border-b border-border">
                    <td className="py-2 pe-6 font-medium text-muted-foreground capitalize">{k.replace(/_/g, ' ')}</td>
                    <td className="py-2 font-mono text-foreground">{Array.isArray(v) ? v.join(', ') : String(v)}</td>
                  </tr>))}
                <tr className="border-b border-border"><td className="py-2 pe-6 font-medium text-muted-foreground">strategy</td>
                  <td className="py-2 font-mono text-foreground">{turn.strategyName}</td></tr>
                <tr><td className="py-2 pe-6 font-medium text-muted-foreground">codegen attempts</td>
                  <td className="py-2 font-mono text-foreground">{turn.codeAttempts}</td></tr>
              </tbody>
            </table>
          </div>
        )}

        {tab === 'code' && (
          <div>
            <div className="inline-block rounded-t-md px-3 py-1.5 text-xs font-mono font-medium text-white" style={{ background: ACCENT }}>
              signal_engine.py
            </div>
            <pre className="rounded-md rounded-tl-none bg-[#282c34] text-zinc-200 p-4 overflow-x-auto text-[12.5px] leading-[1.5] font-mono">
              {turn.generatedCode ? highlightPython(turn.generatedCode) : 'No code available for this run.'}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
};

/* -------------------------------- page -------------------------------- */

type View = 'agent' | 'reports' | 'run' | 'correlation';

const TradingStudio: React.FC = () => {
  const [view, setView] = useState<View>('agent');
  const [credits, setCredits] = useState(0);
  const [budget, setBudget] = useState(50);
  const [prompt, setPrompt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversation, setConversation] = useState<Turn[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [runs, setRuns] = useState<Turn[]>([]);
  const [runsQuery, setRunsQuery] = useState('');
  const [detail, setDetail] = useState<Turn | null>(null);
  const [corrSymbols, setCorrSymbols] = useState('AAPL, MSFT, NVDA, BTC-USD, GLD');
  const [corrWindow, setCorrWindow] = useState(90);
  const [corrMethod, setCorrMethod] = useState<'pearson' | 'spearman'>('pearson');
  const [corrLoading, setCorrLoading] = useState(false);
  const [corrError, setCorrError] = useState<string | null>(null);
  const [corr, setCorr] = useState<{ labels: string[]; matrix: number[][]; observations: number; periodStart: string; periodEnd: string } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const fetchCredits = useCallback(async () => {
    try { const r = await api.get('/trading-studio/credits'); setCredits(r.data?.credits ?? 0); }
    catch (e) { console.error(e); }
  }, []);
  const fetchSessions = useCallback(async () => {
    try { const r = await api.get('/trading-studio/sessions?limit=40'); setSessions(r.data?.sessions || []); }
    catch (e) { console.error(e); }
  }, []);
  const fetchRuns = useCallback(async () => {
    try { const r = await api.get('/trading-studio/runs?limit=50'); setRuns(r.data?.runs || []); }
    catch (e) { console.error(e); }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount; state set in promise callbacks
    fetchCredits(); fetchSessions(); fetchRuns();
    api.get('/trading-studio/pricing').then(r => { if (r.data?.budgetPerTask) setBudget(r.data.budgetPerTask); }).catch(() => {});

    // Runs execute in a Celery worker and live in MongoDB, so they keep going
    // while the user is on another page. On mount, re-attach to whatever is
    // still in flight (or was completed while away) so nothing is lost.
    api.get('/trading-studio/history?limit=5')
      .then(async r => {
        const recent: Turn[] = r.data?.predictions || [];
        const inflight = recent.find(t => t.status === 'PENDING' || t.status === 'PROCESSING');
        const target = inflight || recent[0];
        if (!target) return;
        try {
          const full = await api.get(`/trading-studio/tasks/${target._id}`);
          const t: Turn = full.data;
          const sid = t.sessionId || t._id;
          // Load the whole thread this task belongs to, not just the one turn.
          try {
            const thread = await api.get(`/trading-studio/sessions/${sid}`);
            setConversation(thread.data?.turns || [t]);
          } catch { setConversation([t]); }
          setActiveSessionId(sid);
        } catch { /* ignore — the empty state is fine */ }
      })
      .catch(() => {});
  }, [fetchCredits, fetchSessions, fetchRuns]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [conversation]);

  const activeTurn = conversation.length ? conversation[conversation.length - 1] : null;
  const running = !!activeTurn && (activeTurn.status === 'PENDING' || activeTurn.status === 'PROCESSING');

  useEffect(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (!activeTurn || activeTurn.status === 'COMPLETED' || activeTurn.status === 'FAILED') return;
    pollRef.current = setInterval(async () => {
      try {
        const r = await api.get(`/trading-studio/tasks/${activeTurn._id}?t=${Date.now()}`);
        const t: Turn = r.data;
        setConversation(prev => prev.map(x => (x._id === t._id ? t : x)));
        if (t.status === 'COMPLETED' || t.status === 'FAILED') { fetchCredits(); fetchSessions(); fetchRuns(); }
      } catch (e) { console.error(e); }
    }, 2000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTurn?._id, activeTurn?.status, fetchCredits, fetchSessions, fetchRuns]);

  const computeCorrelation = async () => {
    setCorrError(null); setCorrLoading(true); setCorr(null);
    try {
      const r = await api.get('/trading-studio/correlation', {
        params: { symbols: corrSymbols, window: corrWindow, method: corrMethod },
      });
      setCorr(r.data);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      setCorrError(err.response?.data?.detail || 'Failed to compute the correlation matrix.');
    } finally { setCorrLoading(false); }
  };

  const submit = async (text?: string) => {
    setError(null);
    const q = (text ?? prompt).trim();
    if (!q) { setError('Describe a strategy to backtest, or ask a research question.'); return; }
    setView('agent'); setSubmitting(true);
    try {
      // Continue the active conversation when one is open; otherwise the server
      // starts a fresh session and returns its id, which we then track.
      const r = await api.post('/trading-studio/predict', { prompt: q, sessionId: activeSessionId || undefined });
      setCredits(r.data?.newBalance ?? credits);
      const sid = r.data?.sessionId || activeSessionId;
      setActiveSessionId(sid);
      setConversation(prev => [...prev, { _id: r.data.taskId, prompt: q, sessionId: sid, status: 'PENDING', cost: 0, createdAt: new Date().toISOString() }]);
      setPrompt('');
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      setError(err.response?.data?.detail || 'Failed to start the run.');
    } finally { setSubmitting(false); }
  };

  const openSession = async (s: SessionRow) => {
    setView('agent');
    setActiveSessionId(s.sessionId);
    try {
      const r = await api.get(`/trading-studio/sessions/${s.sessionId}`);
      setConversation(r.data?.turns || []);
    } catch { setConversation([]); }
  };
  const newChat = () => { setConversation([]); setActiveSessionId(null); setPrompt(''); setView('agent'); };
  const openRun = async (r: Turn) => {
    try { const full = await api.get(`/trading-studio/tasks/${r._id}`); setDetail(full.data); }
    catch { setDetail(r); }
    setView('run');
  };

  const filteredRuns = runs.filter(r =>
    !runsQuery || `${r.runId} ${r.prompt} ${r.ticker} ${r.strategyName}`.toLowerCase().includes(runsQuery.toLowerCase()));

  return (
    <div className="flex h-full bg-background text-foreground">
      {/* Left rail — mirrors Vibe-Trading's sidebar */}
      <aside className="w-60 shrink-0 border-e border-border bg-card flex flex-col">
        <div className="p-4 border-b border-border flex items-center gap-2 font-bold tracking-tight">
          <BarChart3 size={18} style={{ color: ACCENT }} /> Trading Studio
        </div>
        <nav className="p-2 space-y-0.5">
          {([['agent', 'Agent', Bot], ['reports', 'Reports', FileText], ['correlation', 'Correlation Matrix', Grid3x3]] as const).map(([k, label, Icon]) => (
            <button key={k} onClick={() => setView(k)}
                    className={`w-full flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                      view === k || (k === 'reports' && view === 'run')
                        ? 'font-medium' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}
                    style={view === k || (k === 'reports' && view === 'run')
                      ? { background: `${ACCENT}1a`, color: ACCENT } : undefined}>
              <Icon size={16} /> {label}
            </button>
          ))}
        </nav>
        <div className="flex-1 overflow-auto border-t border-border mt-2">
          <div className="flex items-center justify-between px-4 py-2">
            <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><MessageSquare size={13} /> Sessions</span>
            <button onClick={newChat} className="text-muted-foreground hover:text-foreground" title="New chat"><Plus size={14} /></button>
          </div>
          <div className="px-2 pb-2 space-y-0.5">
            {sessions.length === 0 && <p className="px-3 py-2 text-xs text-muted-foreground">No sessions yet</p>}
            {sessions.map(s => {
              const active = activeSessionId === s.sessionId;
              return (
                <button key={s.sessionId} onClick={() => openSession(s)} title={s.title}
                        className={`w-full text-start ps-3 pe-2 py-1.5 rounded-md text-xs truncate border-s-2 transition-colors ${
                          active ? 'font-medium' : 'border-s-transparent text-muted-foreground hover:bg-secondary hover:text-foreground'}`}
                        style={active ? { borderInlineStartColor: ACCENT, background: `${ACCENT}14`, color: ACCENT } : undefined}>
                  <span className="flex items-center gap-1.5">
                    <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                      s.lastStatus === 'COMPLETED' ? 'bg-emerald-500/100' : s.lastStatus === 'FAILED' ? 'bg-red-500/100' : 'bg-amber-500/100'}`} />
                    <span className="truncate flex-1">{s.title}</span>
                    {s.turns > 1 && <span className="shrink-0 text-[9px] text-muted-foreground tabular-nums">{s.turns}</span>}
                  </span>
                </button>);
            })}
          </div>
        </div>
        <div className="border-t border-border p-3 flex items-center justify-between text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><Coins size={13} className="text-amber-500" />
            <span className="font-semibold text-foreground">BYOK — no billing</span></span>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {view === 'run' && detail ? (
          <RunDetailView turn={detail} onBack={() => setView('reports')} />
        ) : view === 'correlation' ? (
          <div className="flex-1 overflow-auto p-6">
            <div className="max-w-4xl mx-auto">
              <div className="flex items-center gap-3 mb-1">
                <Grid3x3 size={22} style={{ color: ACCENT }} />
                <h1 className="text-2xl font-bold">Correlation Matrix</h1>
              </div>
              <p className="text-sm text-muted-foreground mb-5">
                Rolling correlation of daily returns across assets — spot diversification gaps in a portfolio.
              </p>

              <div className="rounded-xl border border-border bg-card p-4 space-y-4 mb-6">
                <div>
                  <label className="block text-sm font-medium mb-1.5">Assets</label>
                  <input value={corrSymbols} onChange={e => { setCorrSymbols(e.target.value); setCorr(null); }}
                         placeholder="AAPL, MSFT, BTC-USD, GLD"
                         className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-emerald-500/60" />
                  <p className="text-xs text-muted-foreground mt-1">
                    Comma-separated. Names work too — they're resolved the same way the agent resolves symbols (2–12 assets).
                  </p>
                </div>
                <div className="flex flex-wrap gap-6">
                  <div>
                    <label className="block text-sm font-medium mb-1.5">Window (days)</label>
                    <div className="flex gap-1.5">
                      {[30, 60, 90, 180, 365].map(w => (
                        <button key={w} onClick={() => { setCorrWindow(w); setCorr(null); }}
                                className={`rounded-md px-2.5 py-1.5 text-xs font-medium border transition-colors ${
                                  corrWindow === w ? 'text-white border-transparent' : 'border-border text-muted-foreground hover:text-foreground'}`}
                                style={corrWindow === w ? { background: ACCENT } : undefined}>{w}</button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1.5">Method</label>
                    <div className="flex gap-1.5">
                      {(['pearson', 'spearman'] as const).map(m => (
                        <button key={m} onClick={() => { setCorrMethod(m); setCorr(null); }}
                                className={`rounded-md px-2.5 py-1.5 text-xs font-medium border capitalize transition-colors ${
                                  corrMethod === m ? 'text-white border-transparent' : 'border-border text-muted-foreground hover:text-foreground'}`}
                                style={corrMethod === m ? { background: ACCENT } : undefined}>{m}</button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-end">
                    <button onClick={computeCorrelation} disabled={corrLoading}
                            data-testid="compute-correlation"
                            className="inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                            style={{ background: ACCENT }}>
                      {corrLoading ? <Loader2 size={15} className="animate-spin" /> : <Grid3x3 size={15} />} Compute
                    </button>
                  </div>
                </div>
                {corrError && (
                  <div className="flex items-center gap-2 text-sm text-red-400"><AlertTriangle size={14} /> {corrError}</div>
                )}
              </div>

              {corr && <CorrelationHeatmap data={corr} />}
              {!corr && !corrLoading && !corrError && (
                <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
                  Choose assets and press Compute to build the matrix.
                </div>
              )}
            </div>
          </div>
        ) : view === 'reports' ? (
          <div className="flex-1 overflow-auto p-6">
            <div className="max-w-5xl mx-auto">
              <div className="flex items-start justify-between mb-1">
                <div>
                  <h1 className="text-2xl font-bold">Backtest Report Library</h1>
                  <p className="text-sm text-muted-foreground mt-1">Browse historical backtest reports, metrics, and run details from one place.</p>
                </div>
                <button onClick={fetchRuns} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm hover:bg-secondary">
                  <RefreshCw size={14} /> Refresh</button>
              </div>
              <div className="my-5 flex items-center gap-3">
                <div className="relative flex-1 max-w-md">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input value={runsQuery} onChange={e => setRunsQuery(e.target.value)}
                         placeholder="Search run id, prompt, symbol, strategy..."
                         className="w-full rounded-md border border-border bg-card ps-9 pe-3 py-2 text-sm outline-none focus:border-emerald-500/60" />
                </div>
                <span className="text-sm text-muted-foreground">{filteredRuns.length} of {runs.length} reports</span>
              </div>
              <div className="space-y-3">
                {filteredRuns.length === 0 && (
                  <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
                    No backtest reports yet — ask the agent to backtest a strategy.</div>)}
                {filteredRuns.map(r => (
                  <div key={r._id} className="rounded-xl border border-border bg-card p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 text-emerald-400 px-2 py-0.5 text-xs font-medium">
                            <CheckCircle2 size={11} /> success</span>
                          <span className="font-mono text-sm font-semibold">{r.runId}</span>
                          <span className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</span>
                        </div>
                        <p className="text-sm text-muted-foreground truncate">{r.prompt}</p>
                      </div>
                      <div className="flex items-stretch gap-2 shrink-0">
                        <div className="rounded-md border border-border px-3 py-1.5 text-center">
                          <div className="text-[9px] uppercase tracking-wide text-muted-foreground">Return</div>
                          <div className={`text-sm font-mono font-bold ${(r.metrics?.total_return ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {formatMetric('total_return', r.metrics?.total_return)}</div>
                        </div>
                        <div className="rounded-md border border-border px-3 py-1.5 text-center">
                          <div className="text-[9px] uppercase tracking-wide text-muted-foreground">Sharpe</div>
                          <div className={`text-sm font-mono font-bold ${(r.metrics?.sharpe ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {formatMetric('sharpe', r.metrics?.sharpe)}</div>
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 flex justify-end">
                      <button onClick={() => openRun(r)} className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-white"
                              style={{ background: ACCENT }}>Full Report →</button>
                    </div>
                  </div>))}
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-auto p-6 scroll-smooth">
              <div className="max-w-3xl mx-auto">
                {conversation.length === 0 ? (
                  <div className="py-10">
                    <div className="text-center mb-8">
                      <h1 className="text-3xl font-bold tracking-tight">AI-Powered Quant Strategy Research</h1>
                      <p className="text-muted-foreground mt-3 max-w-xl mx-auto">
                        Describe a trading strategy in natural language. The agent generates code, runs backtests, and analyses the results — all in real time.
                      </p>
                    </div>
                    <div className="grid sm:grid-cols-2 gap-3">
                      {EXAMPLES.map(ex => (
                        <button key={ex.title} onClick={() => submit(ex.prompt)}
                                className="text-start rounded-lg border border-border bg-card p-3.5 hover:border-emerald-500/40 hover:bg-emerald-500/5 transition-colors">
                          <div className="font-semibold text-sm">{ex.title}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">{ex.desc}</div>
                        </button>))}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {conversation.map(turn => (
                      <div key={turn._id} className="space-y-4">
                        <div className="flex justify-end gap-3">
                          <div className="max-w-[72%] rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-white"
                               style={{ background: ACCENT }}>
                            {turn.prompt}
                            <span className="block text-[9px] opacity-60 text-right mt-1">
                              {new Date(turn.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                          <div className="h-7 w-7 rounded-full bg-secondary flex items-center justify-center shrink-0 mt-0.5">
                            <User size={14} className="text-muted-foreground" /></div>
                        </div>
                        <div className="flex gap-3">
                          <AgentAvatar />
                          <div className="flex-1 min-w-0"><AssistantTurn turn={turn} onOpenRun={openRun} /></div>
                        </div>
                      </div>))}
                  </div>
                )}
                <div ref={bottomRef} />
              </div>
            </div>

            <div className="border-t border-border bg-card px-6 py-4">
              <div className="max-w-3xl mx-auto">
                {error && (
                  <div className="mb-2 flex items-center gap-2 text-sm text-red-400" data-testid="form-error">
                    <AlertTriangle size={14} /> {error}</div>)}
                <div className="flex items-end gap-2">
                  <button onClick={newChat} title="New chat"
                          className="h-10 w-10 shrink-0 rounded-full border border-border bg-card flex items-center justify-center text-muted-foreground hover:bg-secondary">
                    <Plus size={16} /></button>
                  <textarea value={prompt} onChange={e => setPrompt(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
                            rows={1} data-testid="prompt-input"
                            placeholder="e.g. Create a dual MA crossover strategy for AAPL, backtest 2026"
                            className="flex-1 rounded-lg border border-border bg-card px-4 py-2.5 text-sm outline-none focus:border-emerald-500/60 resize-none leading-relaxed max-h-40" />
                  <button onClick={() => submit()} disabled={submitting || running} data-testid="predict-button"
                          className="h-10 w-10 shrink-0 rounded-lg flex items-center justify-center text-white disabled:opacity-50 transition-opacity"
                          style={{ background: ACCENT }}>
                    {submitting || running ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}</button>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1.5 text-center">
                  Enter to send · Shift+Enter for a new line · billed per token used, max {budget} credits per run</p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default TradingStudio;
