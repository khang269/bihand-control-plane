import React from 'react';
import { cn } from '../../lib/cn';

export interface IconBadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: 'sm' | 'md' | 'lg';
}

const sizeClasses = {
  sm: 'h-8 w-8 rounded-lg [&>svg]:h-4 [&>svg]:w-4',
  md: 'h-10 w-10 rounded-xl [&>svg]:h-[18px] [&>svg]:w-[18px]',
  lg: 'h-12 w-12 rounded-xl [&>svg]:h-5 [&>svg]:w-5',
};

/** evose.ai-style rounded-square icon badge — dark fill, light icon. */
export const IconBadge: React.FC<IconBadgeProps> = ({ size = 'md', className, children, ...props }) => {
  return (
    <div
      className={cn(
        'flex items-center justify-center bg-primary text-primary-foreground shrink-0',
        sizeClasses[size],
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
};

export default IconBadge;
