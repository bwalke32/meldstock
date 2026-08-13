// @polsia:user-owned — chip helpers for the trading-floor lot ledger. Each chip
// carries its own tone so a feed row reads as a spec sheet, not a wall of
// text. Mobile-first: small footprint, tight padding, monospace caps for the
// spec-sheet feel.
'use client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface ChipProps {
  label: string;
  className?: string;
}

export function HaveChip({ label, className }: ChipProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'rounded-sm px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider',
        'border-primary/60 bg-primary/15 text-primary',
        className,
      )}
    >
      {label}
    </Badge>
  );
}

export function WantedChip({ label, className }: ChipProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'rounded-sm px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider',
        'border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300',
        className,
      )}
    >
      {label}
    </Badge>
  );
}

export function PolymerChip({ label, className }: ChipProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'rounded-sm px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider',
        'border-border bg-secondary text-secondary-foreground',
        className,
      )}
    >
      {label}
    </Badge>
  );
}

export function ConditionChip({ label, className }: ChipProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'rounded-sm px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider',
        'border-border bg-muted text-muted-foreground',
        className,
      )}
    >
      {label}
    </Badge>
  );
}

export function CountryChip({ label, className }: ChipProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'rounded-sm px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider',
        'border-border bg-muted text-muted-foreground',
        className,
      )}
    >
      {label}
    </Badge>
  );
}

export function GradeChip({ label, className }: ChipProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'rounded-sm px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider',
        'border-primary/40 bg-primary/10 text-primary',
        className,
      )}
    >
      {label}
    </Badge>
  );
}

export function KgChip({ label, className }: ChipProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'rounded-sm px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider',
        'border-border bg-secondary text-secondary-foreground',
        className,
      )}
    >
      {label}
    </Badge>
  );
}

export function FormChip({ label, className }: ChipProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'rounded-sm px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider',
        'border-border bg-background text-foreground',
        className,
      )}
    >
      {label}
    </Badge>
  );
}

export function PriceChip({
  label,
  isPlaceholder,
  className,
}: ChipProps & { isPlaceholder?: boolean }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'rounded-sm px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider',
        isPlaceholder
          ? 'border-border bg-muted text-muted-foreground italic'
          : 'border-primary/40 bg-primary/10 text-primary',
        className,
      )}
    >
      {label}
    </Badge>
  );
}

export function CoaChip({ present, className }: { present: boolean; className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'rounded-sm px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider',
        present
          ? 'border-primary/40 bg-primary/10 text-primary'
          : 'border-border bg-muted text-muted-foreground',
        className,
      )}
    >
      {present ? 'COA ✓' : 'no COA'}
    </Badge>
  );
}

export function RecycledChip({ label, className }: ChipProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'rounded-sm px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider',
        'border-primary/40 bg-primary/5 text-foreground',
        className,
      )}
    >
      {label}
    </Badge>
  );
}
