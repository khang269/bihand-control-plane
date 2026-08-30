import React from 'react';
import { cn } from '../../lib/cn';

export interface Stat {
  value: React.ReactNode;
  label: React.ReactNode;
}

export interface StatRowProps extends React.HTMLAttributes<HTMLDivElement> {
  stats: Stat[];
  /** Use light text for a dark CTA-band context. */
  inverted?: boolean;
}

// Tailwind's JIT scanner needs literal class strings, so column counts are pre-enumerated rather than interpolated.
const colsForCount: Record<number, string> = {
  1: 'md:grid-cols-1',
  2: 'md:grid-cols-2',
  3: 'md:grid-cols-3',
  4: 'md:grid-cols-4',
};

export const StatRow: React.FC<StatRowProps> = ({ stats, inverted, className, ...props }) => {
  const colsClass = colsForCount[Math.min(stats.length, 4)] || colsForCount[4];
  return (
    <div className={cn('grid grid-cols-2 gap-4', colsClass, className)} {...props}>
      {stats.map((stat, i) => (
        <div
          key={i}
          className={cn(
            'rounded-2xl border p-4 text-center',
            inverted ? 'border-white/10 bg-white/5' : 'border-border bg-card'
          )}
        >
          <div className={cn('text-2xl font-extrabold', inverted ? 'text-white' : 'text-foreground')}>
            {stat.value}
          </div>
          <div className={cn('text-xs mt-1', inverted ? 'text-white/60' : 'text-muted-foreground')}>
            {stat.label}
          </div>
        </div>
      ))}
    </div>
  );
};

export default StatRow;
