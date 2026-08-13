// @polsia:user-owned — desk-style recent-lots feed. Renders compact trade-desk
// rows for each item: monospace timestamp, type chip, polymer chip, condition
// chip, weight, country, asking price, COA flag. Click row → /lots/[id].
'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  CoaChip,
  ConditionChip,
  CountryChip,
  FormChip,
  HaveChip,
  KgChip,
  PolymerChip,
  PriceChip,
  WantedChip,
} from '@/components/custom/lot-chips';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  conditionLabel,
  formatLb,
  formatPricePerLb,
  formatTimestamp,
  polymerLabel,
  relativeAge,
  shortLotId,
} from '@/lib/business/lots';
import type { LotCondition, LotItem, Polymer } from '@/lib/contracts/lots';
import { cn } from '@/lib/utils';

interface RecentLotsFeedProps {
  items: LotItem[];
  /** Total of items behind the dropdown list (used for the "more arrived" counter). */
  freshCount?: number;
  lastRefreshedAt?: number | null;
}

export function RecentLotsFeed({
  items,
  freshCount = 0,
  lastRefreshedAt = null,
}: RecentLotsFeedProps) {
  // Tick once a second so "Xm ago" and the live clock keep moving.
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 1_000);
    return () => clearInterval(id);
  }, []);

  const clock = lastRefreshedAt ? formatTimestamp(new Date(lastRefreshedAt).toISOString()) : '—';

  return (
    <Card className="border-border bg-card shadow-sm">
      <CardHeader className="gap-1 border-b border-border">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inset-0 animate-ping rounded-full bg-primary/60" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
            </span>
            <CardTitle className="font-display text-lg tracking-tight text-foreground">
              Recent trades
            </CardTitle>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            last refresh {clock}
          </span>
        </div>
        <CardDescription>
          {freshCount > 0
            ? `${freshCount} new since last refresh`
            : `${items.length} active listing${items.length === 1 ? '' : 's'}`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 p-3">
        {items.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="flex flex-col">
            {items.map((lot, index) => (
              <li key={lot.id}>
                <LotRow lot={lot} isNew={index === 0} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-start gap-2 rounded-md border border-dashed border-border bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
      <span className="font-medium text-foreground">Floor is quiet.</span>
      <span>Submit the first lot from the form on the left; it will land here.</span>
    </div>
  );
}

function LotRow({ lot, isNew }: { lot: LotItem; isNew: boolean }) {
  const shortId = shortLotId(lot);
  const time = formatTimestamp(lot.createdAt);
  const age = relativeAge(lot.createdAt);
  const polymer = polymerLabel(lot.polymer as Polymer);
  const condition = conditionLabel(lot.condition as LotCondition);
  const price = formatPricePerLb(lot.askingPricePerLb);

  return (
    <Link
      href={`/lots/${lot.id}`}
      className={cn(
        'group relative flex flex-col gap-1.5 rounded-md border border-transparent px-3 py-2.5 transition-colors duration-150 hover:border-primary/30 hover:bg-muted/40',
        isNew && 'recent-row-pulse',
      )}
      aria-label={`Open lot ${shortId}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          <span>{time}</span>
          <span aria-hidden>·</span>
          <span>{age} ago</span>
        </div>
        <div className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          <span>L-{shortId}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {lot.type === 'HAVE' ? <HaveChip label="HAVE" /> : <WantedChip label="WANTED" />}
        <PolymerChip label={polymer} />
        <ConditionChip label={condition} />
        <FormChip label={lot.form} />
        <KgChip label={formatLb(lot.quantityLb)} />
        {lot.country ? <CountryChip label={lot.country} /> : null}
        <PriceChip label={price.label} isPlaceholder={price.isPlaceholder} />
        {lot.hasCoa ? <CoaChip present /> : <CoaChip present={false} />}
      </div>
      <div className="flex items-end justify-between gap-2">
        <p className="line-clamp-1 text-[11px] text-muted-foreground">
          {lot.manufacturer ? lot.manufacturer : 'Manufacturer n/a'}
          {lot.grade ? ` · ${lot.grade}` : ''}
          {lot.location ? ` · ${lot.location}` : ''}
          {lot.postedByHandle ? (
            <>
              {' · '}
              <span className="font-mono text-foreground">@{lot.postedByHandle}</span>
            </>
          ) : null}
        </p>
        <Button
          asChild
          variant="link"
          size="sm"
          className="h-auto px-0 text-[11px] font-mono uppercase tracking-wider"
        >
          <span>Open lot →</span>
        </Button>
      </div>
      {lot.notes ? (
        <p className="line-clamp-1 text-[11px] italic text-muted-foreground/80">{lot.notes}</p>
      ) : null}
    </Link>
  );
}
