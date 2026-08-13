// @polsia:user-owned — single metric tile on the dashboard overview. Static
// presentation; the parent composes three of these in a responsive grid.
// Optional linked footer (count → filtered `/lots` view).
'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface MetricTileProps {
  label: string;
  value: number;
  sublabel?: string;
  href?: string;
  accent?: ReactNode;
  className?: string;
}

export function MetricTile({ label, value, sublabel, href, accent, className }: MetricTileProps) {
  const body = (
    <Card
      className={cn(
        'group/card h-full border-border bg-card shadow-sm lift',
        href && 'cursor-pointer',
        className,
      )}
    >
      <CardContent className="flex h-full flex-col gap-4 p-5">
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {label}
          </span>
          {accent ? <div className="shrink-0">{accent}</div> : null}
        </div>
        <div className="flex flex-1 items-end gap-3">
          <span className="font-display text-display leading-none tracking-[-0.02em] text-foreground tabular-nums">
            {value}
          </span>
          {sublabel ? (
            <span className="pb-1 text-caption text-muted-foreground">{sublabel}</span>
          ) : null}
        </div>
        {href ? (
          <span className="font-mono text-[10px] uppercase tracking-wider text-primary transition-colors group-hover/card:text-primary/80">
            View →
          </span>
        ) : (
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            &nbsp;
          </span>
        )}
      </CardContent>
    </Card>
  );
  if (href) {
    return (
      <Link href={href} aria-label={`${label}: open`} className="block h-full">
        {body}
      </Link>
    );
  }
  return body;
}
