/** Metric formatting + palette shared by the Trading Studio components.
 *  Kept in a non-component module so react-refresh stays happy. */

export const ACCENT = '#10b981';
export const GREEN = '#34d399';
export const RED = '#f87171';


export const METRIC_LABELS: Record<string, string> = {
  total_return: 'Total Return', annual_return: 'Annual', sharpe: 'Sharpe',
  max_drawdown: 'Max DD', win_rate: 'Win Rate', trade_count: 'Trades',
  calmar: 'Calmar', sortino: 'Sortino', profit_loss_ratio: 'P/L Ratio',
  max_consecutive_loss: 'Max Consec. Loss', benchmark_return: 'Benchmark',
  excess_return: 'Excess Return', final_value: 'Final Value',
  avg_holding_days: 'Avg Hold Days', initial_cash: 'Initial Cash',
};

// Same ordering as vibe-trading's DISPLAY_ORDER
export const METRIC_ORDER = [
  'total_return', 'annual_return', 'sharpe', 'max_drawdown', 'win_rate', 'trade_count',
  'calmar', 'sortino', 'profit_loss_ratio', 'max_consecutive_loss',
  'benchmark_return', 'excess_return', 'final_value', 'avg_holding_days',
];
export const COMPACT_METRICS = ['total_return', 'annual_return', 'sharpe', 'max_drawdown', 'win_rate', 'trade_count'];

const PCT_KEYS = new Set(['total_return', 'annual_return', 'win_rate', 'max_drawdown', 'benchmark_return', 'excess_return']);
const RATIO_KEYS = new Set(['sharpe', 'calmar', 'sortino', 'profit_loss_ratio']);
const SIGNED = new Set(['total_return', 'annual_return', 'benchmark_return', 'excess_return', 'sharpe', 'calmar', 'sortino', 'profit_loss_ratio', 'win_rate']);

export function formatMetric(k: string, v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  const sign = SIGNED.has(k) && v >= 0 ? '+' : '';
  if (PCT_KEYS.has(k)) return `${sign}${(v * 100).toFixed(2)}%`;
  if (RATIO_KEYS.has(k)) return `${sign}${v.toFixed(2)}`;
  if (k === 'final_value' || k === 'initial_cash') return Math.round(v).toLocaleString();
  if (k === 'avg_holding_days') return v.toFixed(1);
  return String(v);
}

export function metricSentiment(k: string, v: number | null | undefined): 'positive' | 'neutral' | 'negative' {
  if (v === null || v === undefined) return 'neutral';
  if (k === 'max_drawdown') return v > -0.05 ? 'positive' : v > -0.2 ? 'neutral' : 'negative';
  if (k === 'win_rate') return v >= 0.5 ? 'positive' : v >= 0.35 ? 'neutral' : 'negative';
  if (RATIO_KEYS.has(k)) return v >= 1.0 ? 'positive' : v >= 0.3 ? 'neutral' : 'negative';
  if (PCT_KEYS.has(k)) return v > 0 ? 'positive' : v < 0 ? 'negative' : 'neutral';
  if (k === 'max_consecutive_loss') return v <= 2 ? 'neutral' : 'negative';
  return 'neutral';
}

export const SENTIMENT_CLASS: Record<string, string> = {
  positive: 'text-emerald-400', neutral: 'text-[#fafafa]', negative: 'text-red-400',
};

