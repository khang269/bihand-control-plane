import React from 'react';
import { cn } from '../../lib/cn';

export interface WindowFrameProps extends React.HTMLAttributes<HTMLDivElement> {
  url?: string;
}

/** evose-style "product screenshot" chrome — a dark browser-window frame around a UI preview. */
export const WindowFrame: React.FC<WindowFrameProps> = ({ url, className, children, ...props }) => {
  return (
    <div className={cn('rounded-2xl border border-border bg-zinc-950 text-zinc-100 shadow-xl overflow-hidden', className)} {...props}>
      <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-zinc-900/60 shrink-0">
        <span className="h-2.5 w-2.5 rounded-full bg-red-500/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-500/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/70" />
        {url && <span className="ml-3 text-[11px] text-zinc-500 font-mono truncate">{url}</span>}
      </div>
      {children}
    </div>
  );
};

export default WindowFrame;
