import React from 'react';
import { cn } from '../../lib/cn';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Disable the default padding when a child needs edge-to-edge content. */
  noPadding?: boolean;
}

export const Card: React.FC<CardProps> = ({ className, noPadding, children, ...props }) => {
  return (
    <div
      className={cn(
        'rounded-2xl border border-border bg-card text-card-foreground shadow-sm',
        !noPadding && 'p-5',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
};

export default Card;
