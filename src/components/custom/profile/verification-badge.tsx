// @polsia:user-owned — presentational verification status badge. Used by the
// public profile, the lot detail link chip, and the profile-edit dashboard
// (signals "your company is verified" / "request pending review"). Three
// visual modes: verified (green check), pending (amber clock), rejected (red
// inaccessible), unverified (muted). Rendered as a small inline pill so it
// reads as part of an identity row, not a standalone card.
'use client';

import { Check, Clock, ShieldAlert, ShieldOff } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export type VerifiedBadge = 'none' | 'pending' | 'verified' | 'rejected';

interface VerificationBadgeProps {
  status: VerifiedBadge;
  /** Override the displayed label (e.g. show a role-specific phrase). */
  label?: string;
  /** Force an iconified compact mode for use inside list pills. */
  compact?: boolean;
  className?: string;
}

const META: Record<
  VerifiedBadge,
  {
    label: string;
    classes: string;
    Icon: typeof Check;
  }
> = {
  none: {
    label: 'Unverified',
    classes: 'border-border bg-muted text-muted-foreground hover:bg-muted/80 dark:bg-muted/60',
    Icon: ShieldAlert,
  },
  pending: {
    label: 'Verification pending',
    classes: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-200',
    Icon: Clock,
  },
  verified: {
    label: 'Verified company',
    classes: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200',
    Icon: Check,
  },
  rejected: {
    label: 'Verification rejected',
    classes: 'border-destructive/40 bg-destructive/10 text-destructive',
    Icon: ShieldOff,
  },
};

export function VerificationBadge({
  status,
  label,
  compact = false,
  className,
}: VerificationBadgeProps) {
  const meta = META[status];
  const Icon = meta.Icon;
  const text = label ?? meta.label;
  return (
    <Badge
      variant="outline"
      className={cn(
        'gap-1 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider',
        meta.classes,
        className,
      )}
      aria-label={text}
    >
      <Icon className={cn('h-3 w-3', compact ? '' : '-ml-0.5')} aria-hidden />
      {compact ? null : <span>{text}</span>}
    </Badge>
  );
}
