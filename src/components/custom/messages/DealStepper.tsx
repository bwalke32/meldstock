// @polsia:user-owned — compact horizontal deal-stepper strip, rendered
// inside the thread view and the lot detail page. Each pill is wired
// to the same `DealStatus` enum as the API contract. The same
// component is reused across both placements so the visual language
// stays consistent.
//
// States:
//   - Step ≤ current: filled with the brand-tinted primary colour.
//   - Current step: outlined, slightly bigger, aria-current="step" + an
//     accessible "current step" label announced by screen readers.
//   - Step > current: muted, no fill.
//
// If `canAdvance` is `true` (the caller is the seller or a platform
// admin — server-stamped), the strip also surfaces a `<Select>` that
// can advance the strip to any later step. Successful PATCHes update
// the local state in place AND dispatch `deal-status:invalidate` so
// the lot detail island re-fetches; buyer-side viewers tick forward
// via the 20 s poll on `Thread` (see messages/thread.tsx).
'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { apiFetch } from '@/lib/api-client';
import { relativeAge } from '@/lib/business/lots';
import {
  DEAL_STATUS_ORDER,
  type DealStatus,
  DealStatusEnum,
  DealStatusUpdated,
} from '@/lib/contracts/messaging';

export interface DealStepperProps {
  threadId: string;
  dealStatus: DealStatus;
  dealStatusUpdatedAt: string | null;
  canAdvance: boolean;
  /** Optional copy under the strip — typically "Open thread →". */
  footer?: React.ReactNode;
}

// Human-readable short labels for the seven steps. Kept compact so
// the seven pills fit on a single line at desktop widths.
const STEP_LABELS: Record<DealStatus, string> = {
  OFFER: 'Offer',
  ACCEPTED: 'Accepted',
  PO_ISSUED: 'PO issued',
  PICKUP_SCHEDULED: 'Pickup set',
  IN_TRANSIT: 'In transit',
  DELIVERED: 'Delivered',
  COMPLETED: 'Completed',
};

export function DealStepper({
  threadId,
  dealStatus: initialDealStatus,
  dealStatusUpdatedAt: initialUpdatedAt,
  canAdvance,
  footer,
}: DealStepperProps) {
  // Local state mirrors the server — the optimistic update on a
  // successful PATCH collapses the second round-trip. The server
  // value still wins on every subsequent refresh / poll / invalidate.
  const [dealStatus, setDealStatus] = useState<DealStatus>(initialDealStatus);
  const [updatedAt, setUpdatedAt] = useState<string | null>(initialUpdatedAt);
  const [submitting, setSubmitting] = useState(false);

  // Reconcile with the parent's re-fetched value. The thread page
  // re-hydrates its detail GET on `deal-status:invalidate` and every
  // 20 s; without this effect the local state would be stuck on the
  // FIRST prop value forever, and a buyer who never opened the
  // dropdown would never see the seller's advance. Re-setting the
  // same value is a no-op; if `submitting` is true the parent re-fetch
  // would land BEFORE the PATCH response arrives, BUT the round-trip
  // is bounded by an optimistic `setDealStatus(target)` so the
  // parent's value matches the optimistic one and this no-ops either
  // way.
  useEffect(() => {
    setDealStatus(initialDealStatus);
    setUpdatedAt(initialUpdatedAt);
  }, [initialDealStatus, initialUpdatedAt]);

  const currentIndex = DEAL_STATUS_ORDER.indexOf(dealStatus);

  async function advanceTo(target: DealStatus) {
    if (submitting) return;
    const targetIndex = DEAL_STATUS_ORDER.indexOf(target);
    // Belt-and-braces: the <Select> in this component only offers
    // strictly-greater options, but guarding here so a future caller
    // doesn't accidentally rewind the strip.
    if (targetIndex <= currentIndex) return;

    const previous = dealStatus;
    const previousStamp = updatedAt;
    setSubmitting(true);
    // Optimistic local advance so the visible pill flips BEFORE the
    // round-trip; revert on failure.
    setDealStatus(target);
    setUpdatedAt(new Date().toISOString());
    try {
      const updated = await apiFetch(`/api/threads/${encodeURIComponent(threadId)}/deal-status`, {
        method: 'PATCH',
        body: JSON.stringify({ dealStatus: target }),
        schema: DealStatusUpdated,
      });
      setDealStatus(DealStatusEnum.parse(updated.dealStatus));
      setUpdatedAt(updated.dealStatusUpdatedAt ?? new Date().toISOString());
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('deal-status:invalidate'));
      }
      toast.success(`Deal advanced to ${STEP_LABELS[target]}.`);
    } catch (err: unknown) {
      // Revert + surface the server's verbatim error so the user sees
      // the real reason (e.g. lost admin permission, room kind).
      setDealStatus(previous);
      setUpdatedAt(previousStamp);
      const body = (err as { cause?: { error?: string } } | undefined)?.cause;
      toast.error(body?.error ?? 'Could not advance the deal stepper.');
    } finally {
      setSubmitting(false);
    }
  }

  const advanceOptions: DealStatus[] = DEAL_STATUS_ORDER.slice(currentIndex + 1);

  return (
    <section
      aria-label="Deal progress"
      className="flex flex-col gap-3 rounded-md border border-border bg-card px-4 py-3"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-eyebrow text-primary">Deal progress</span>
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            step {currentIndex + 1} / {DEAL_STATUS_ORDER.length}
          </span>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {updatedAt !== null ? `updated ${relativeAge(updatedAt)}` : 'awaiting first advance'}
        </span>
      </header>

      <ol
        aria-label="Deal progress stages"
        className="flex flex-nowrap items-center gap-1 overflow-x-auto"
      >
        {DEAL_STATUS_ORDER.map((step, i) => {
          const state = i < currentIndex ? 'past' : i === currentIndex ? 'current' : 'future';
          return (
            <li key={step} className="flex flex-1 items-center gap-1 last:flex-initial">
              <StepPill step={step} index={i} state={state} label={STEP_LABELS[step]} />
              {i < DEAL_STATUS_ORDER.length - 1 ? (
                <span
                  aria-hidden="true"
                  className={
                    i < currentIndex ? 'h-px flex-1 bg-primary/70' : 'h-px flex-1 bg-border'
                  }
                />
              ) : null}
            </li>
          );
        })}
      </ol>

      {canAdvance && advanceOptions.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-eyebrow text-muted-foreground">Advance to</span>
          <Select
            value=""
            onValueChange={(value) => {
              const target = DealStatusEnum.parse(value);
              void advanceTo(target);
            }}
            disabled={submitting}
          >
            <SelectTrigger
              className="h-8 w-[180px] text-sm"
              aria-label="Advance the deal to a later step"
            >
              <SelectValue placeholder={submitting ? 'Saving…' : 'Choose next step'} />
            </SelectTrigger>
            <SelectContent>
              {advanceOptions.map((opt) => (
                <SelectItem key={opt} value={opt}>
                  {STEP_LABELS[opt]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {footer}
    </section>
  );
}

function StepPill({
  step,
  index,
  state,
  label,
}: {
  step: DealStatus;
  index: number;
  state: 'past' | 'current' | 'future';
  label: string;
}) {
  // Visual states map to brand-tinted tokens so the strip stays ON
  // palette — past pills use the soft primary tint, the current
  // pill gets an outlined ring + larger box, future pills are muted
  // grey with no fill. Accessible labels announce the position to
  // screen readers: "Step 3 — PO issued (current step)".
  const base =
    'inline-flex shrink-0 items-center justify-center rounded-full border font-mono uppercase tracking-wider whitespace-nowrap';
  const size =
    state === 'current' ? 'h-9 min-w-9 px-3 text-[11px]' : 'h-7 min-w-7 px-2 text-[10px]';
  const looks =
    state === 'past'
      ? 'border-primary/40 bg-primary/15 text-primary'
      : state === 'current'
        ? 'border-primary bg-primary text-primary-foreground shadow-sm'
        : 'border-border bg-muted text-muted-foreground';
  // `<span>` has the default `generic` role which doesn't support
  // `aria-label` (lint/a11y/useAriaPropsSupportedByRole). Visible label
  // content is wrapped in `aria-hidden` siblings and the full
  // human-readable copy (including "(current step)" / "(done)" suffix)
  // is delivered via a single `sr-only` child so screen readers hear
  // exactly the same announcement without doubling up the visible
  // label or fetching an aria-label on a generic role.
  return (
    <span
      aria-current={state === 'current' ? 'step' : undefined}
      data-step={step}
      data-state={state}
      className={`${base} ${size} ${looks}`}
    >
      <span className="sr-only">
        Step {index + 1} of {DEAL_STATUS_ORDER.length} — {label}
        {state === 'current' ? ' (current step)' : state === 'past' ? ' (done)' : ''}
      </span>
      <span aria-hidden="true" className="mr-1 opacity-70">
        {index + 1}
      </span>
      <span aria-hidden="true">{label}</span>
    </span>
  );
}
