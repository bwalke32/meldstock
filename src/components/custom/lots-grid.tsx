// @polsia:user-owned — responsive grid + empty state for the /lots browse
// page. One column on mobile, two on `sm`, three on `lg+`.
'use client';

import { LotCard } from '@/components/custom/lot-card';
import { Card, CardContent } from '@/components/ui/card';
import type { LotItem } from '@/lib/contracts/lots';

interface LotsGridProps {
  items: LotItem[];
}

export function LotsGrid({ items }: LotsGridProps) {
  if (items.length === 0) {
    return (
      <Card className="border-border bg-card/60">
        <CardContent className="flex flex-col items-start gap-2 py-10">
          <span className="font-display text-lg tracking-tight text-foreground">
            No lots match these filters
          </span>
          <span className="text-sm text-muted-foreground">
            Clear filters and try again, or push the first matching lot from{' '}
            <span className="font-mono">/post-a-lot</span>.
          </span>
        </CardContent>
      </Card>
    );
  }
  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((lot) => (
        <li key={lot.id} className="h-full">
          <LotCard lot={lot} />
        </li>
      ))}
    </ul>
  );
}
