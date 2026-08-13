// @polsia:user-owned — server-renderable Meldstock visual helpers.

import type * as React from 'react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// --- FAQ accordion (server-renderable shell) -------------------------
export function MeldstockFAQ({ items }: { items: { q: string; a: string }[] }) {
  return (
    <Accordion type="single" collapsible defaultValue={items[0]?.q} className="w-full">
      {items.map((it) => (
        <AccordionItem key={it.q} value={it.q} className="border-border">
          <AccordionTrigger className="text-left text-base font-semibold text-foreground hover:no-underline hover:text-primary">
            {it.q}
          </AccordionTrigger>
          <AccordionContent className="text-base leading-relaxed text-muted-foreground">
            {it.a}
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

// --- Sparkline (SVG, server-renderable) -----------------------------
export function Sparkline({
  series,
  width = 160,
  height = 48,
  className,
  strokeDasharray,
  uid = 'spark',
}: {
  series: number[];
  width?: number;
  height?: number;
  className?: string;
  strokeDasharray?: string;
  uid?: string;
}) {
  if (series.length < 2) return null;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1;
  const stepX = width / (series.length - 1);
  const pts = series
    .map(
      (v, i) =>
        `${(i * stepX).toFixed(2)},${(height - ((v - min) / span) * (height - 6) - 3).toFixed(2)}`,
    )
    .join(' ');
  const lastY = Number(pts.split(' ').pop()?.split(',')[1] ?? height / 2);
  const last = series[series.length - 1] ?? 0;
  const first = series[0] ?? 0;
  const dir = last > first ? 'up' : last < first ? 'down' : 'flat';
  return (
    <svg
      role="img"
      aria-label={`Trend ${dir}`}
      viewBox={`0 0 ${width} ${height}`}
      className={cn('text-primary', className)}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={`${uid}-fill`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.35" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline
        points={`0,${height} ${pts} ${width},${height}`}
        fill={`url(#${uid}-fill)`}
        stroke="none"
      />
      <polyline
        points={pts}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={strokeDasharray}
      />
      <circle cx={width - 0.5} cy={lastY} r="2.5" fill="currentColor" />
    </svg>
  );
}

// --- Status pill: uses only semantic brand tokens so it flips with the theme --
export function StatusBadge({
  tone,
  children,
}: {
  tone: 'available' | 'reserved' | 'gone';
  children: React.ReactNode;
}) {
  const toneClass =
    tone === 'available'
      ? 'bg-primary/15 text-primary border-primary/40'
      : tone === 'reserved'
        ? 'bg-secondary text-secondary-foreground border-border'
        : 'bg-muted text-muted-foreground border-border';
  return (
    <Badge
      variant="outline"
      className={cn(
        'rounded-full px-2.5 font-mono text-[10px] uppercase tracking-wider',
        toneClass,
      )}
    >
      {children}
    </Badge>
  );
}

// --- Meldmark: asymmetric melt-flow SVG mark for the hero -----------
export function Meldmark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 240 240" aria-hidden className={cn('text-primary', className)}>
      <title>Meldmark</title>
      <defs>
        <radialGradient id="meldmarkGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.45" />
          <stop offset="60%" stopColor="currentColor" stopOpacity="0.06" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="120" cy="120" r="118" fill="url(#meldmarkGlow)" />
      {[110, 84, 60, 36, 16].map((r, idx) => (
        <ellipse
          key={r}
          cx="120"
          cy="120"
          rx={r}
          ry={r * (0.46 + idx * 0.06)}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.25 + idx * 0.12}
          strokeWidth="1"
        />
      ))}
      <path d="M14 120 H226" stroke="currentColor" strokeOpacity="0.4" strokeDasharray="2 4" />
      <path d="M120 14 V226" stroke="currentColor" strokeOpacity="0.4" strokeDasharray="2 4" />
      <circle cx="120" cy="120" r="3" fill="currentColor" />
    </svg>
  );
}
