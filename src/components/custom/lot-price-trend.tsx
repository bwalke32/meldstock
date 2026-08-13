// @polsia:user-owned — price-trend sparkline strip rendered ABOVE the
// spec-sheet Card on /lots/[id]. Fetches the 30-day same-polymer +
// grade-equivalent asking-price series from /api/lots/[id]/price-trend
// via the shared zod contract, then renders a hand-rolled SVG sparkline
// (no charting dep — the strip is too small to warrant one) plus a
// min/median/max label row and a "You are here" marker at the source
// lot's asking-price level (when the source lot has one).
'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api-client';
import { formatPricePerLb, polymerLabel } from '@/lib/business/lots';
import type { Polymer } from '@/lib/contracts/lots';
import {
  type PriceTrendResponse,
  PriceTrendResponse as PriceTrendResponseSchema,
  type PriceTrendStats,
} from '@/lib/contracts/price-trend';

type State =
  | { kind: 'loading' }
  | { kind: 'empty' }
  | { kind: 'error' }
  | { kind: 'ready'; data: PriceTrendResponse };

interface LotPriceTrendProps {
  lotId: string;
  polymer: Polymer;
  grade: string | null;
  askingPricePerLb: string | null;
}

const BG_LIGHT = 'bg-card';
const MUTED_TEXT = 'text-muted-foreground';

export function LotPriceTrend({ lotId, polymer, grade, askingPricePerLb }: LotPriceTrendProps) {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let active = true;
    apiFetch(`/api/lots/${encodeURIComponent(lotId)}/price-trend`, {
      schema: PriceTrendResponseSchema,
    })
      .then((data) => {
        if (!active) {
          return;
        }
        // Surface the "no priced comparables in the last 30 days" empty
        // state when the server returned 200 with an empty series. The
        // route deliberately returns 200 (not 404) for this case so the
        // contract stays simpler and the strip can render the empty state.
        if (data.series.length === 0) {
          setState({ kind: 'empty' });
        } else {
          setState({ kind: 'ready', data });
        }
      })
      .catch(() => {
        if (active) {
          setState({ kind: 'error' });
        }
      });
    return () => {
      active = false;
    };
  }, [lotId]);

  const cohort = `Price trend — last 30 days · same ${polymerLabel(polymer)}${grade ? ` · ${grade}` : ''}`;

  return (
    <section
      className={`overflow-hidden rounded-md border border-border ${BG_LIGHT}`}
      aria-label={cohort}
    >
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <span className="text-eyebrow text-primary">{cohort}</span>
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          30-day sparkline
        </span>
      </header>

      <div className="flex flex-col gap-4 px-4 pb-4 pt-3">
        {state.kind === 'loading' ? <Skeleton /> : null}
        {state.kind === 'empty' ? <EmptyState /> : null}
        {state.kind === 'error' ? <ErrorState /> : null}
        {state.kind === 'ready' ? (
          <Ready
            stats={state.data.stats}
            series={state.data.series}
            windowStart={state.data.windowStart}
            windowEnd={state.data.windowEnd}
            askingPricePerLb={askingPricePerLb}
          />
        ) : null}
      </div>
    </section>
  );
}

function Ready({
  stats,
  series,
  windowStart,
  windowEnd,
  askingPricePerLb,
}: {
  stats: PriceTrendStats;
  series: PriceTrendResponse['series'];
  windowStart: string;
  windowEnd: string;
  askingPricePerLb: string | null;
}) {
  const currentPriceNumber =
    askingPricePerLb === null || askingPricePerLb === undefined
      ? null
      : Number.parseFloat(askingPricePerLb);
  const hasCurrentPrice =
    currentPriceNumber !== null && Number.isFinite(currentPriceNumber) && currentPriceNumber > 0;

  // 5% headroom so the median dot + the "You are here" line aren't clipped
  // when a row sits exactly at top/bottom.
  const span = Math.max(0, stats.max - stats.min);
  const pad = span === 0 ? Math.max(stats.max * 0.05, 0.01) : span * 0.05;
  const yMin = Math.max(0, stats.min - pad);
  const yMax = stats.max + pad;
  const yRange = yMax - yMin || 1;

  const W = 280;
  const H = 64;
  const padY = 4;

  // X-mapping: snapshot the LEFT edge of every day in the 30-day window,
  // not the day the FIRST priced comparable fell on. That keeps the
  // marker (today) anchored right + days without series points render
  // as gaps instead of a misleadingly-shifted ramp.
  const windowDates = enumerateWindowDays(windowStart, windowEnd);
  const xForDate = new Map(windowDates.map((d, i) => [d, i]));

  const points = series
    .map((p) => {
      const idx = xForDate.get(p.date);
      if (idx === undefined) return null;
      const x = idxToX(idx, windowDates.length, W);
      const y = priceToY(p.median, yMin, yRange, H, padY);
      return { x, y, p };
    })
    .filter((pt): pt is { x: number; y: number; p: (typeof series)[number] } => pt !== null);

  const polylinePoints = points.map((pt) => `${pt.x.toFixed(2)},${pt.y.toFixed(2)}`).join(' ');

  // Reference line at the source lot's asking price (when priced).
  const todayX = idxToX(windowDates.length - 1, windowDates.length, W);
  const currentY = hasCurrentPrice
    ? priceToY(currentPriceNumber as number, yMin, yRange, H, padY)
    : null;

  return (
    <>
      <div className="relative">
        {hasCurrentPrice ? (
          <span
            className="absolute right-0 top-0 rounded-sm border border-primary/40 bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-primary"
            aria-hidden
          >
            You are here · {formatPricePerLb(askingPricePerLb).label}
          </span>
        ) : null}
        {/* 1:1 baseline on every other day so the eye can align the median
            dot to a date label below — sparse-day charts need this or
            they read as noise. */}
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-16 w-full"
          role="img"
          aria-label={`Median asking price per day, ${windowStart} to ${windowEnd}`}
        >
          {[0.25, 0.5, 0.75].map((frac) => (
            <line
              key={frac}
              x1={0}
              x2={W}
              y1={H * frac}
              y2={H * frac}
              stroke="currentColor"
              className={MUTED_TEXT}
              strokeOpacity={0.15}
              strokeDasharray="2 4"
            />
          ))}

          {currentY !== null ? (
            <>
              <line
                x1={0}
                x2={W}
                y1={currentY}
                y2={currentY}
                stroke="currentColor"
                className="text-primary"
                strokeOpacity={0.45}
                strokeDasharray="4 4"
              />
              <circle
                cx={todayX}
                cy={currentY}
                r={3.5}
                fill="currentColor"
                className="text-primary"
              />
            </>
          ) : null}

          {points.length >= 2 ? (
            <polyline
              points={polylinePoints}
              fill="none"
              stroke="currentColor"
              className="text-primary"
              strokeWidth={1.5}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ) : null}

          {points.map((pt) => (
            <circle
              key={pt.p.date}
              cx={pt.x}
              cy={pt.y}
              r={2}
              fill="currentColor"
              className="text-primary"
            />
          ))}

          <line
            x1={todayX}
            x2={todayX}
            y1={0}
            y2={H}
            stroke="currentColor"
            className={MUTED_TEXT}
            strokeOpacity={0.3}
          />
        </svg>
      </div>

      {!hasCurrentPrice ? (
        <p className="text-xs text-muted-foreground">
          Set an asking price to see where you sit on the 30-day trend.
        </p>
      ) : null}

      <dl className="grid grid-cols-3 gap-x-3 gap-y-1 border-t border-border pt-3 text-[11px]">
        <Stat term="Min" value={formatPricePerLb(stats.min).label} />
        <Stat term="Median" value={formatPricePerLb(stats.median).label} accent />
        <Stat term="Max" value={formatPricePerLb(stats.max).label} />
      </dl>
    </>
  );
}

function Stat({ term, value, accent }: { term: string; value: string; accent?: boolean }) {
  return (
    <div>
      <dt className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        {term}
      </dt>
      <dd className={accent ? 'font-medium text-foreground' : 'text-foreground'}>{value}</dd>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-3" aria-hidden>
      <div className="h-16 rounded-sm bg-muted/50" />
      <div className="grid grid-cols-3 gap-x-3 border-t border-border pt-3">
        <div className="h-7 rounded-sm bg-muted/40" />
        <div className="h-7 rounded-sm bg-muted/40" />
        <div className="h-7 rounded-sm bg-muted/40" />
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-sm border border-dashed border-border bg-muted/30 px-3 py-5 text-sm text-muted-foreground">
      No priced comparables in the last 30 days.
    </div>
  );
}

function ErrorState() {
  return (
    <div className="rounded-sm border border-dashed border-border bg-muted/30 px-3 py-5 text-sm text-muted-foreground">
      Price trend is temporarily unavailable.
    </div>
  );
}

function enumerateWindowDays(windowStart: string, windowEnd: string): string[] {
  const start = new Date(`${windowStart}T00:00:00`);
  const end = new Date(`${windowEnd}T00:00:00`);
  const out: string[] = [];
  const step = 24 * 60 * 60 * 1000;
  for (let t = start.getTime(); t <= end.getTime(); t += step) {
    const d = new Date(t);
    out.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    );
  }
  return out;
}

function idxToX(idx: number, total: number, w: number): number {
  if (total <= 1) return w / 2;
  return (idx / (total - 1)) * w;
}

function priceToY(price: number, yMin: number, yRange: number, h: number, padY: number): number {
  const usable = h - padY * 2;
  // Clamp so a "You are here" line whose price exceeds the visible
  // window's max (or falls under the floor) stays anchored at the edge
  // instead of vanishing off-canvas.
  const frac = Math.min(1, Math.max(0, (price - yMin) / yRange));
  return h - padY - usable * frac;
}
