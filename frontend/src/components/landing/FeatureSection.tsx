import React from 'react';
import { Sparkles } from 'lucide-react';
import { cn } from '../../lib/cn';
import { IconBadge } from '../ui/IconBadge';

export interface FeatureSectionProps {
  index: number;
  icon: React.ElementType;
  title: string;
  description: string;
  example: string;
  exampleLabel: string;
  reverse?: boolean;
  visual: React.ReactNode;
}

/**
 * evose-style capability deep-dive: alternating text/visual layout, a numbered eyebrow,
 * and a "real-world example" callout so each capability is demonstrated, not just described.
 */
export const FeatureSection: React.FC<FeatureSectionProps> = ({
  index,
  icon: Icon,
  title,
  description,
  example,
  exampleLabel,
  reverse,
  visual,
}) => {
  return (
    <section className="max-w-6xl mx-auto px-6 py-16 border-t border-border">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-center">
        <div className={cn(reverse && 'lg:order-2')}>
          <div className="flex items-center gap-3 mb-5">
            <IconBadge size="sm">
              <Icon size={16} />
            </IconBadge>
            <span className="text-xs font-mono text-muted-foreground">0{index}</span>
          </div>
          <h3 className="text-2xl md:text-3xl font-bold tracking-tight mb-3">{title}</h3>
          <p className="text-muted-foreground leading-relaxed mb-5">{description}</p>
          <div className="rounded-xl border border-border bg-secondary/50 p-4 flex gap-3">
            <Sparkles size={16} className="shrink-0 text-muted-foreground mt-0.5" />
            <p className="text-sm leading-relaxed">
              <span className="font-semibold">{exampleLabel}: </span>
              <span className="text-muted-foreground">{example}</span>
            </p>
          </div>
        </div>
        <div className={cn(reverse && 'lg:order-1')}>{visual}</div>
      </div>
    </section>
  );
};

export default FeatureSection;
