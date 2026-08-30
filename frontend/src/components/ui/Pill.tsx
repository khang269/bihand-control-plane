import React from 'react';
import { cn } from '../../lib/cn';

/** Small rounded-full chip — evose-style hero badge ("Building AI Organizations"). */
export const Pill: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, children, ...props }) => {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-1.5 text-xs font-medium text-muted-foreground shadow-sm',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
};

export default Pill;
