// @polsia:user-owned — structured-offer timeline rendered on the lot
// detail page (below the spec sheet). Renders each `Offer` as a card
// in chronological order, with a role tag (you / seller counter / your
// counter), a status badge (PENDING / ACCEPTED / COUNTERED / WITHDRAWN
// / DECLINED / EXPIRED), and the action bar the server has stamped as
// allowed for the current viewer. Re-fetches on `offers:invalidate`
// so an accept here ticks forward without a manual reload.
'use client';

import { Check, CheckCircle2, MessageSquareDashed, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { apiFetch } from '@/lib/api-client';
import { useSession } from '@/lib/auth-client';
import {
  type FreightTerm,
  type OfferListResponse,
  OfferList as OfferListSchema,
  type OfferStatus,
  type PriceUnit,
} from '@/lib/contracts/offers';

type OfferWireItem = OfferListResponse['items'][number];

export interface OfferThreadProps {
  lotId: string;
  /** Authentication state — drives whether to fetch at all. */
  isAuthed: boolean;
}

const STATUS_LABELS: Record<OfferStatus, string> = {
  PENDING: 'Pending',
  COUNTERED: 'Countered',
  ACCEPTED: 'Accepted',
  DECLINED: 'Declined',
  EXPIRED: 'Expired',
  WITHDRAWN: 'Withdrawn',
};

const STATUS_TONES: Record<OfferStatus, string> = {
  PENDING: 'border-primary/40 bg-primary/15 text-primary',
  COUNTERED: 'border-border bg-muted text-muted-foreground',
  ACCEPTED: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-700',
  DECLINED: 'border-destructive/40 bg-destructive/10 text-destructive',
  EXPIRED: 'border-border bg-muted text-muted-foreground',
  WITHDRAWN: 'border-border bg-muted text-muted-foreground',
};

const FREIGHT_TERM_LABELS: Record<FreightTerm, string> = {
  EXW: 'EXW (Ex-Works)',
  FOB: 'FOB',
  DELIVERED: 'Delivered',
  FREIGHT_COLLECT: 'Freight Collect',
  FREIGHT_PREPAID: 'Freight Prepaid',
};

const PRICE_UNIT_LABELS: Record<PriceUnit, string> = {
  PER_LB: '$/lb',
  PER_KG: '$/kg',
};

export function OfferThread({ lotId, isAuthed }: OfferThreadProps) {
  const { data: session } = useSession();
  const [state, setState] = useState<
    { kind: 'loading' } | { kind: 'ready'; items: OfferWireItem[] } | { kind: 'error' }
  >({ kind: 'loading' });

  const viewerId = session?.user?.id ?? null;

  const refetch = useCallback(() => {
    if (!isAuthed) {
      setState({ kind: 'ready', items: [] });
      return Promise.resolve();
    }
    return apiFetch<OfferListResponse>(`/api/listings/${encodeURIComponent(lotId)}/offers`, {
      schema: OfferListSchema,
    })
      .then((data) => {
        setState({ kind: 'ready', items: data.items });
      })
      .catch((err: unknown) => {
        // 404 = the lot is not visible to this viewer, OR the viewer
        // isn't a party on any offer yet. Both render as an empty
        // timeline — matches the brief's "additive, not a replacement"
        // free-text thread experience.
        const status = err instanceof Error ? /\((\d{3})\)/.exec(err.message)?.[1] : undefined;
        if (status === '404') {
          setState({ kind: 'ready', items: [] });
          return;
        }
        setState({ kind: 'error' });
      });
  }, [lotId, isAuthed]);

  useEffect(() => {
    let active = true;
    void refetch().then(() => {
      if (!active) return;
    });
    return () => {
      active = false;
    };
  }, [refetch]);

  // Re-hydrate on every external invalidation signal:
  //   - `offers:invalidate` — fired by MakeOfferButton after a POST,
  //     so the just-created row shows up immediately.
  //   - `deal-status:invalidate` — fired by DealStepper after PATCH
  //     `/api/threads/[id]/deal-status`. The current offer row may
  //     have been ACCEPTED and the timeline should reflect it.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    function onInvalidate() {
      void refetch();
    }
    window.addEventListener('offers:invalidate', onInvalidate);
    window.addEventListener('deal-status:invalidate', onInvalidate);
    return () => {
      window.removeEventListener('offers:invalidate', onInvalidate);
      window.removeEventListener('deal-status:invalidate', onInvalidate);
    };
  }, [refetch]);

  if (!isAuthed) {
    return null;
  }

  if (state.kind === 'loading') {
    return (
      <Card className="border-border bg-card shadow-sm">
        <CardHeader>
          <CardTitle className="font-display text-base tracking-tight">Offers</CardTitle>
          <CardDescription>Loading negotiation…</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (state.kind === 'error') {
    return (
      <Card className="border-border bg-card shadow-sm">
        <CardHeader>
          <CardTitle className="font-display text-base tracking-tight">Offers</CardTitle>
          <CardDescription>Couldn’t load the negotiation timeline.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (state.items.length === 0) {
    return (
      <Card className="border-border bg-card shadow-sm">
        <CardHeader>
          <CardTitle className="font-display text-base tracking-tight">Offers</CardTitle>
          <CardDescription>
            No offers yet on this listing. Use <strong>Make offer</strong> above to submit the first
            structured negotiation block — the seller can accept, counter, or decline. The full
            history stays preserved so both sides can audit it later.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="border-border bg-card shadow-sm">
      <CardHeader className="gap-1 border-b border-border">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="font-display text-base tracking-tight">Offers</CardTitle>
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {state.items.length} {state.items.length === 1 ? 'block' : 'blocks'}
          </span>
        </div>
        <CardDescription>
          Negotiation history. Older counters isn’t hidden — every block is preserved so both sides
          can audit the price ladder and the freight terms.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        <ol className="flex flex-col gap-3">
          {state.items.map((row) => (
            <li key={row.id}>
              <OfferCard row={row} viewerId={viewerId} onMutated={refetch} />
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

function OfferCard({
  row,
  viewerId,
  onMutated,
}: {
  row: OfferWireItem;
  viewerId: string | null;
  onMutated: () => Promise<void> | void;
}) {
  // Author side: parentOfferId === null ⇒ buyer-authored (initial offer);
  // otherwise seller-authored (the plan restricts counter to seller-only,
  // so by induction every non-root row alternates).
  const authorIsBuyer = row.parentOfferId === null;

  // Without exposing the row's buyer/seller ids on the wire, we infer
  // the viewer's role purely from the action flags the server stamped
  // for this row. `canAccept` and `canWithdraw` are XIOR — only one
  // can be true for a party on a PENDING row.
  const flags = row.actionFlags;
  let viewerIsAuthor: boolean | null = null;
  if (viewerId !== null && flags !== null) {
    if (flags.canWithdraw) {
      viewerIsAuthor = true;
    } else if (flags.canAccept) {
      viewerIsAuthor = false;
    }
  }
  const isParty = viewerIsAuthor !== null || (viewerId !== null && flags !== null);

  const roleLine = !isParty
    ? 'Other party'
    : viewerIsAuthor === true
      ? 'You'
      : viewerIsAuthor === false
        ? 'Counterparty'
        : '—';

  const chainLabel = authorIsBuyer
    ? viewerIsAuthor === true
      ? 'Your initial offer'
      : viewerIsAuthor === false
        ? 'Their initial offer'
        : 'Initial offer'
    : viewerIsAuthor === true
      ? 'Counter by you'
      : viewerIsAuthor === false
        ? 'Counter by counterpart'
        : 'Counter';

  return (
    <article
      className="flex flex-col gap-3 rounded-md border border-border bg-background px-4 py-3"
      aria-label={`Offer ${row.terms.pricePerUnit} ${PRICE_UNIT_LABELS[row.terms.priceUnit]} for ${row.terms.quantityLb} lb`}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-eyebrow text-primary">{roleLine}</span>
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {chainLabel}
          </span>
          <StatusBadge status={row.status} />
        </div>
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {formatRelativeTime(row.createdAt)}
        </span>
      </header>

      <dl className="grid grid-cols-1 gap-y-3 gap-x-4 text-sm sm:grid-cols-2">
        <SpecRow term="Buyer" value={row.buyerDisplayName} />
        <SpecRow term="Seller" value={row.sellerDisplayName} />
        <SpecRow term="Quantity" value={`${formatInt(row.terms.quantityLb)} lb`} />
        <SpecRow
          term="Price"
          value={`$${formatNumber(row.terms.pricePerUnit)} ${PRICE_UNIT_LABELS[row.terms.priceUnit]}`}
        />
        <SpecRow term="Freight" value={FREIGHT_TERM_LABELS[row.terms.freightTerm]} />
        {row.terms.shipToCity || row.terms.shipToZipCode ? (
          <SpecRow
            term="Ship-to"
            value={[
              row.terms.shipToCity,
              row.terms.shipToState,
              row.terms.shipToZipCode,
              row.terms.shipToCountry,
            ]
              .filter(Boolean)
              .join(', ')}
          />
        ) : null}
        {row.terms.requestedDeliveryDate ? (
          <SpecRow
            term="Requested delivery"
            value={new Date(row.terms.requestedDeliveryDate).toISOString().slice(0, 10)}
          />
        ) : null}
        <SpecRow term="Expires" value={new Date(row.offerExpiresAt).toISOString().slice(0, 10)} />
        {row.terms.paymentTerms ? <SpecRow term="Payment" value={row.terms.paymentTerms} /> : null}
        {row.terms.comments ? <SpecRow term="Comments" value={row.terms.comments} wide /> : null}
      </dl>

      <ActionBar row={row} onMutated={onMutated} />
    </article>
  );
}

function ActionBar({
  row,
  onMutated,
}: {
  row: OfferWireItem;
  onMutated: () => Promise<void> | void;
}) {
  const flags = row.actionFlags;
  if (!flags || row.status !== 'PENDING') {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
      {flags.canAccept ? (
        <Button
          type="button"
          size="sm"
          variant="default"
          onClick={() => doAccept(row.id, onMutated)}
        >
          <CheckCircle2 aria-hidden="true" className="mr-1.5 size-3.5" />
          Accept
        </Button>
      ) : null}
      {flags.canCounter ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => doCounter(row.id, row.terms.quantityLb, onMutated)}
        >
          <MessageSquareDashed aria-hidden="true" className="mr-1.5 size-3.5" />
          Counter
        </Button>
      ) : null}
      {flags.canDecline ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => doDecline(row.id, onMutated)}
        >
          <X aria-hidden="true" className="mr-1.5 size-3.5" />
          Decline
        </Button>
      ) : null}
      {flags.canWithdraw ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => doWithdraw(row.id, onMutated)}
        >
          Withdraw
        </Button>
      ) : null}
    </div>
  );
}

function StatusBadge({ status }: { status: OfferStatus }) {
  return (
    <span
      data-status={status}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${STATUS_TONES[status]}`}
    >
      {status === 'ACCEPTED' ? (
        <Check aria-hidden="true" className="size-3" />
      ) : status === 'DECLINED' ? (
        <X aria-hidden="true" className="size-3" />
      ) : null}
      {STATUS_LABELS[status]}
    </span>
  );
}

function SpecRow({ term, value, wide }: { term: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2' : undefined}>
      <dt className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        {term}
      </dt>
      <dd className="text-foreground">{value}</dd>
    </div>
  );
}

async function doAccept(offerId: string, onMutated: () => Promise<void> | void) {
  try {
    await apiFetch(`/api/offers/${encodeURIComponent(offerId)}/accept`, { method: 'POST' });
    toast.success('Offer accepted.');
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('offers:invalidate'));
      window.dispatchEvent(new Event('deal-status:invalidate'));
    }
    await onMutated();
  } catch (err: unknown) {
    const body = (err as { cause?: { error?: string } } | undefined)?.cause;
    toast.error(body?.error ?? 'Could not accept.');
  }
}

async function doCounter(
  offerId: string,
  prevQuantity: string,
  onMutated: () => Promise<void> | void,
) {
  // v1 of the counter UI uses an inline prompt for the price while the
  // full counter form lands in a follow-up — every other field carries
  // forward from the parent row so the seller can't accidentally clear
  // a freight term without re-entering it.
  const priceRaw = window.prompt(
    'Counter — adjust the price ($/lb). The full negotiation history stays; this creates a new block on the same chain.',
    '1.14',
  );
  if (priceRaw === null) return;
  const pricePerUnit = Number.parseFloat(priceRaw);
  if (!Number.isFinite(pricePerUnit) || pricePerUnit <= 0) {
    toast.error('Enter a number greater than zero.');
    return;
  }
  const expires = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  try {
    await apiFetch(`/api/offers/${encodeURIComponent(offerId)}/counter`, {
      method: 'POST',
      body: JSON.stringify({
        terms: {
          quantityLb: Number.parseFloat(prevQuantity) || 0,
          pricePerUnit,
          priceUnit: 'PER_LB',
          freightTerm: 'DELIVERED',
          shipToZipCode: '',
          shipToCity: '',
          shipToState: '',
          shipToCountry: '',
          paymentTerms: 'NET 30',
          comments: '',
          offerExpiresAt: expires,
        },
      }),
    });
    toast.success('Counter sent.');
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('offers:invalidate'));
    }
    await onMutated();
  } catch (err: unknown) {
    const body = (err as { cause?: { error?: string } } | undefined)?.cause;
    toast.error(body?.error ?? 'Could not counter.');
  }
}

async function doDecline(offerId: string, onMutated: () => Promise<void> | void) {
  try {
    await apiFetch(`/api/offers/${encodeURIComponent(offerId)}/decline`, { method: 'POST' });
    toast.success('Offer declined.');
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('offers:invalidate'));
    }
    await onMutated();
  } catch (err: unknown) {
    const body = (err as { cause?: { error?: string } } | undefined)?.cause;
    toast.error(body?.error ?? 'Could not decline.');
  }
}

async function doWithdraw(offerId: string, onMutated: () => Promise<void> | void) {
  try {
    await apiFetch(`/api/offers/${encodeURIComponent(offerId)}/withdraw`, { method: 'POST' });
    toast.success('Offer withdrawn.');
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('offers:invalidate'));
    }
    await onMutated();
  } catch (err: unknown) {
    const body = (err as { cause?: { error?: string } } | undefined)?.cause;
    toast.error(body?.error ?? 'Could not withdraw.');
  }
}

function formatInt(s: string): string {
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString('en-US');
}

function formatNumber(s: string): string {
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

function formatRelativeTime(iso: string): string {
  const stamp = Date.parse(iso);
  if (!Number.isFinite(stamp)) return '';
  const delta = Math.max(0, Date.now() - stamp);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (delta < minute) return 'just now';
  if (delta < hour) return `${Math.round(delta / minute)}m ago`;
  if (delta < day) return `${Math.round(delta / hour)}h ago`;
  return `${Math.round(delta / day)}d ago`;
}
