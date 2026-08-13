// @polsia:user-owned — chip strip rendered above the /lots grid. Reflects
// what the resin-abbreviation parser picked out of the search input so the
// user sees the structured filter values that were applied.
//
// Pure presentational island. Always render with `chips={null}` when no
// input was typed or nothing was recognised — the strip disappears so it
// doesn't compete for visual weight against the lot grid.
'use client';

import { Badge } from '@/components/ui/badge';
import type { ResinChip } from '@/lib/business/resin-abbreviations';
import { cn } from '@/lib/utils';

interface ResinChipsProps {
  chips: ResinChip[] | null;
}

export function ResinChips({ chips }: ResinChipsProps) {
  if (!chips || chips.length === 0) return null;
  return (
    <output
      aria-label="Parsed resin filters"
      className="flex flex-wrap items-center gap-1.5 rounded-md border border-dashed border-border/80 bg-muted/30 px-3 py-2"
    >
      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        Parsed →
      </span>
      {chips.map((chip, idx) => (
        <Badge
          key={`${chip.tone}-${chip.label}-${idx}`}
          variant="outline"
          className={cn(toneClass(chip.tone))}
        >
          {chip.label}
        </Badge>
      ))}
    </output>
  );
}

function toneClass(tone: ResinChip['tone']): string {
  const base = 'rounded-sm px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider';
  switch (tone) {
    case 'polymer':
      return `${base} border-primary/60 bg-primary/15 text-primary`;
    case 'glass':
      return `${base} border-primary/40 bg-primary/10 text-primary`;
    case 'mfr':
      return `${base} border-primary/40 bg-primary/10 text-primary`;
    case 'flame':
      return `${base} border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300`;
    case 'color':
      return `${base} border-border bg-secondary text-secondary-foreground`;
    default:
      return base;
  }
}
