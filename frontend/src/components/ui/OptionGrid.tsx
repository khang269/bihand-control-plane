import React from 'react';
import { cn } from '../../lib/cn';

export interface OptionGridItem {
  value: string;
  label: React.ReactNode;
  sublabel?: React.ReactNode;
  badge?: React.ReactNode;
  meta?: React.ReactNode;
  disabled?: boolean;
}

export interface OptionGridProps {
  options: OptionGridItem[];
  value: string;
  onChange: (value: string) => void;
  columns?: 2 | 3 | 4 | 5;
  /** 'sm' = compact single-line pill (aspect ratio, counts); 'md' = richer card with sublabel/badge/meta. */
  size?: 'sm' | 'md';
  className?: string;
}

const columnClasses: Record<number, string> = {
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
  5: 'grid-cols-5',
};

/** Grid of clickable, single-select tiles — style/aspect-ratio/model pickers and small segmented toggles. */
export const OptionGrid: React.FC<OptionGridProps> = ({ options, value, onChange, columns = 2, size = 'md', className }) => {
  return (
    <div className={cn('grid gap-2', columnClasses[columns], className)}>
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            disabled={opt.disabled}
            onClick={() => onChange(opt.value)}
            className={cn(
              'relative rounded-lg border transition-all disabled:opacity-50 disabled:cursor-not-allowed',
              size === 'sm' ? 'px-3 py-1.5 text-xs font-semibold text-center' : 'p-3 text-left',
              selected
                ? 'border-primary bg-primary/5 text-foreground'
                : 'border-border text-muted-foreground hover:border-ring hover:text-foreground'
            )}
          >
            {opt.badge && (
              <span className="absolute top-2 right-2 rounded-md border border-border bg-secondary px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-muted-foreground">
                {opt.badge}
              </span>
            )}
            <div className={cn(size === 'md' && 'text-xs font-extrabold text-foreground')}>{opt.label}</div>
            {opt.sublabel && <div className="mt-0.5 text-[10px] text-muted-foreground">{opt.sublabel}</div>}
            {opt.meta && <div className="mt-2.5 flex items-center gap-1 text-xs font-extrabold text-purple-500">{opt.meta}</div>}
          </button>
        );
      })}
    </div>
  );
};

export default OptionGrid;
