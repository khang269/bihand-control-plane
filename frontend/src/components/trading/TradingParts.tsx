/**
 * Trading Studio building blocks — a faithful port of Vibe-Trading's chat/report
 * components (MetricsCard, MiniEquityChart, ThinkingTimeline, RunCompleteCard,
 * candlestick chart with B/S markers) using this app's Tailwind setup.
 *
 * Vibe-Trading's layout and information design, recoloured to Bihand's dark
 * theme (emerald accent on zinc surfaces), mono tabular metric values.
 */
import React from 'react';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { ACCENT, GREEN, RED, metricSentiment, formatMetric, METRIC_LABELS, COMPACT_METRICS, METRIC_ORDER, SENTIMENT_CLASS } from './tradingFormat';

export const MetricsCard: React.FC<{ metrics: Record<string, number | null>; compact?: boolean }> = ({ metrics, compact }) => {
  const keys = (compact ? COMPACT_METRICS : METRIC_ORDER).filter(k => metrics[k] !== undefined && metrics[k] !== null);
  if (keys.length === 0) return null;
  return (
    <div className={`grid gap-1.5 rounded-xl border border-border bg-background p-3 ${compact ? 'grid-cols-3' : 'grid-cols-[repeat(auto-fit,minmax(110px,1fr))]'}`}>
      {keys.map(k => (
        <div key={k} className="text-center py-1">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">{METRIC_LABELS[k] || k}</p>
          <p className={`text-sm font-bold font-mono tabular-nums mt-0.5 ${SENTIMENT_CLASS[metricSentiment(k, metrics[k])]}`}>
            {formatMetric(k, metrics[k])}
          </p>
        </div>
      ))}
    </div>
  );
};

/* ------------------------------- charts ------------------------------- */

export const MiniEquityChart: React.FC<{ values: number[]; height?: number }> = ({ values, height = 90 }) => {
  if (!values || values.length < 2) return null;
  const w = 640;
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(height - ((v - min) / range) * (height - 8) - 4).toFixed(1)}`);
  const up = values[values.length - 1] >= values[0];
  const color = up ? GREEN : RED;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full" style={{ height }} preserveAspectRatio="none">
      <polygon points={`0,${height} ${pts.join(' ')} ${w},${height}`} fill={color} opacity="0.10" />
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
};

export interface Candle { date: string; open: number; high: number; low: number; close: number; volume: number }
export interface Marker { date: string; kind: 'B' | 'S'; price: number }

/** Candlestick + MA overlays + volume + B/S trade markers, matching their run chart. */
export const CandleChart: React.FC<{ candles: Candle[]; markers?: Marker[] }> = ({ candles, markers = [] }) => {
  if (!candles || candles.length < 2) return null;
  const W = 1000, H = 300, VH = 70, PAD_L = 52, PAD_R = 8, PAD_T = 8;
  const n = candles.length;
  const hi = Math.max(...candles.map(c => c.high));
  const lo = Math.min(...candles.map(c => c.low));
  const range = hi - lo || 1;
  const plotW = W - PAD_L - PAD_R;
  const cw = Math.max(1.2, (plotW / n) * 0.62);
  const x = (i: number) => PAD_L + (i + 0.5) * (plotW / n);
  const y = (p: number) => PAD_T + (1 - (p - lo) / range) * (H - PAD_T - 20);

  const ma = (period: number) => candles.map((_, i) =>
    i < period - 1 ? null : candles.slice(i - period + 1, i + 1).reduce((s, c) => s + c.close, 0) / period);
  const ma5 = ma(5), ma20 = ma(20);
  const line = (arr: (number | null)[], color: string) => {
    const pts = arr.map((v, i) => (v === null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean) as string[];
    return pts.length > 1 ? <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="1" opacity="0.9" /> : null;
  };

  const maxVol = Math.max(...candles.map(c => c.volume)) || 1;
  const gridVals = [0, 0.25, 0.5, 0.75, 1].map(f => lo + range * f);
  const idxByDate = new Map(candles.map((c, i) => [c.date, i]));

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H + VH + 24}`} className="w-full min-w-[560px]" style={{ height: H + VH + 24 }}>
        {gridVals.map((v, i) => (
          <g key={i}>
            <line x1={PAD_L} y1={y(v)} x2={W - PAD_R} y2={y(v)} stroke="hsl(var(--color-border))" strokeWidth="0.5" />
            <text x={PAD_L - 6} y={y(v) + 3} fontSize="9" fill="hsl(var(--color-muted-foreground))" textAnchor="end" fontFamily="monospace">
              {v >= 1000 ? Math.round(v).toLocaleString() : v.toFixed(2)}
            </text>
          </g>
        ))}
        {candles.map((c, i) => {
          const up = c.close >= c.open;
          const col = up ? GREEN : RED;
          const yO = y(c.open), yC = y(c.close);
          return (
            <g key={i}>
              <line x1={x(i)} y1={y(c.high)} x2={x(i)} y2={y(c.low)} stroke={col} strokeWidth="0.8" />
              <rect x={x(i) - cw / 2} y={Math.min(yO, yC)} width={cw} height={Math.max(0.8, Math.abs(yC - yO))}
                    fill={up ? 'none' : col} stroke={col} strokeWidth="0.8" />
            </g>
          );
        })}
        {line(ma5, '#eab308')}
        {line(ma20, '#a855f7')}
        {markers.map((m, i) => {
          const idx = idxByDate.get(m.date);
          if (idx === undefined) return null;
          const isBuy = m.kind === 'B';
          const my = isBuy ? y(candles[idx].low) + 12 : y(candles[idx].high) - 12;
          return (
            <g key={i}>
              <circle cx={x(idx)} cy={my} r="6.5" fill={isBuy ? GREEN : RED} />
              <text x={x(idx)} y={my + 3} fontSize="8" fill="#fff" textAnchor="middle" fontWeight="bold">{m.kind}</text>
            </g>
          );
        })}
        <g transform={`translate(0, ${H})`}>
          {candles.map((c, i) => {
            const h = (c.volume / maxVol) * (VH - 10);
            return <rect key={i} x={x(i) - cw / 2} y={VH - h} width={cw} height={h}
                         fill={c.close >= c.open ? GREEN : RED} opacity="0.35" />;
          })}
        </g>
        <text x={PAD_L} y={H + VH + 16} fontSize="9" fill="hsl(var(--color-muted-foreground))" fontFamily="monospace">{candles[0].date}</text>
        <text x={W - PAD_R} y={H + VH + 16} fontSize="9" fill="hsl(var(--color-muted-foreground))" textAnchor="end" fontFamily="monospace">{candles[n - 1].date}</text>
        <g transform={`translate(${W - PAD_R - 150}, ${PAD_T + 6})`}>
          <rect x="0" y="-7" width="9" height="2" fill="#eab308" /><text x="13" y="-3" fontSize="9" fill="hsl(var(--color-muted-foreground))">MA5</text>
          <rect x="46" y="-7" width="9" height="2" fill="#a855f7" /><text x="59" y="-3" fontSize="9" fill="hsl(var(--color-muted-foreground))">MA20</text>
        </g>
      </svg>
    </div>
  );
};

/** Equity + drawdown panel from the run artifacts. */
export const EquityDrawdownChart: React.FC<{ dates: string[]; equity: number[]; drawdown: number[] }> = ({ dates, equity, drawdown }) => {
  if (!equity || equity.length < 2) return null;
  const W = 1000, EH = 170, DH = 70, PAD_L = 56, PAD_R = 8;
  const min = Math.min(...equity), max = Math.max(...equity);
  const range = max - min || 1;
  const x = (i: number) => PAD_L + (i / (equity.length - 1)) * (W - PAD_L - PAD_R);
  const ey = (v: number) => 8 + (1 - (v - min) / range) * (EH - 16);
  const maxDd = Math.min(...drawdown, 0) || -1;
  const dy = (v: number) => 4 + (v / maxDd) * (DH - 12);
  const up = equity[equity.length - 1] >= equity[0];
  const col = up ? GREEN : RED;
  const ePts = equity.map((v, i) => `${x(i).toFixed(1)},${ey(v).toFixed(1)}`);
  const dPts = drawdown.map((v, i) => `${x(i).toFixed(1)},${dy(v).toFixed(1)}`);
  const base = equity[0];
  return (
    <svg viewBox={`0 0 ${W} ${EH + DH + 26}`} className="w-full" style={{ height: EH + DH + 26 }}>
      {[max, (max + min) / 2, min].map((v, i) => (
        <g key={i}>
          <line x1={PAD_L} y1={ey(v)} x2={W - PAD_R} y2={ey(v)} stroke="hsl(var(--color-border))" strokeWidth="0.5" />
          <text x={PAD_L - 6} y={ey(v) + 3} fontSize="9" fill="hsl(var(--color-muted-foreground))" textAnchor="end" fontFamily="monospace">{Math.round(v).toLocaleString()}</text>
        </g>
      ))}
      <line x1={PAD_L} y1={ey(base)} x2={W - PAD_R} y2={ey(base)} stroke="hsl(var(--color-muted-foreground))" strokeWidth="0.7" strokeDasharray="4 3" />
      <polygon points={`${PAD_L},${ey(base)} ${ePts.join(' ')} ${W - PAD_R},${ey(base)}`} fill={col} opacity="0.10" />
      <polyline points={ePts.join(' ')} fill="none" stroke={col} strokeWidth="1.6" />
      <g transform={`translate(0, ${EH + 12})`}>
        <text x={PAD_L - 6} y={10} fontSize="9" fill="hsl(var(--color-muted-foreground))" textAnchor="end" fontFamily="monospace">0%</text>
        <text x={PAD_L - 6} y={DH - 6} fontSize="9" fill="hsl(var(--color-muted-foreground))" textAnchor="end" fontFamily="monospace">{(maxDd * 100).toFixed(0)}%</text>
        <polygon points={`${PAD_L},4 ${dPts.join(' ')} ${W - PAD_R},4`} fill={RED} opacity="0.18" />
        <polyline points={dPts.join(' ')} fill="none" stroke={RED} strokeWidth="1.2" />
      </g>
      <text x={PAD_L} y={EH + DH + 22} fontSize="9" fill="hsl(var(--color-muted-foreground))" fontFamily="monospace">{dates[0]}</text>
      <text x={W - PAD_R} y={EH + DH + 22} fontSize="9" fill="hsl(var(--color-muted-foreground))" textAnchor="end" fontFamily="monospace">{dates[dates.length - 1]}</text>
    </svg>
  );
};

/* ---------------------------- agent timeline ---------------------------- */

export interface AgentStep { name: string; status: 'running' | 'done'; detail?: string; at: string }

export const ThinkingTimeline: React.FC<{ steps: AgentStep[] }> = ({ steps }) => {
  // Each tool call posts a "running" step immediately followed by a "done"
  // step for the same name — without merging, a step that finished a dozen
  // steps ago still shows its old spinner sitting in the transcript, reading
  // as "still loading" even once the whole turn has completed. Drop a
  // "running" row when the very next row resolves it.
  const visible = steps.filter((s, i) => {
    if (s.status !== 'running') return true;
    const next = steps[i + 1];
    return !(next && next.name === s.name && next.status === 'done');
  });
  return (
    <div className="space-y-1.5 rounded-lg border border-border bg-background px-3 py-2.5">
      {visible.map((s, i) => (
        <div key={i} className="flex items-start gap-2 text-[13px]">
          {s.status === 'done'
            ? <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-400" />
            : <Loader2 size={14} className="mt-0.5 shrink-0 animate-spin" style={{ color: ACCENT }} />}
          <div className="min-w-0">
            <span className={s.status === 'done' ? 'text-muted-foreground' : 'text-foreground font-medium'}>{s.name}</span>
            {s.detail && <span className="text-muted-foreground"> — {s.detail}</span>}
          </div>
        </div>
      ))}
    </div>
  );
};

export const AgentAvatar: React.FC = () => (
  <div className="h-7 w-7 rounded-md flex items-center justify-center shrink-0 text-white text-xs font-bold"
       style={{ background: '#155e75' }}>P</div>
);

export const ToolBadge: React.FC<{ icon: React.ReactNode; label: string; onClick?: () => void; active?: boolean }> = ({ icon, label, onClick, active }) => (
  <button onClick={onClick}
          className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
            active ? 'text-white' : 'text-muted-foreground hover:bg-secondary border border-border'}`}
          style={active ? { background: ACCENT } : undefined}>
    {icon} {label}
  </button>
);

