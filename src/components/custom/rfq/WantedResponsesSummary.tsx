// @polsia:user-owned — structured seller-response timeline rendered on
// the lot detail page (below the spec sheet, alongside the spec card).
//
// Layout: per-seller CHAIN — every seller who responded gets a card
// containing their response blocks in chronological order (oldest
// first). The brief specifies the "side-by-side comparison view"
// for the lot poster is the EXISTING inbox surface at
// /dashboard/messages, where each respondent has a separate per-
// (WANTED-lot, respondent) thread that lists as its own row in the
// left pane; the summary here adds an in-context action bar so the
// poster can accept/counter/decline directly without leaving the
// listing page, then deep-links to the per-seller thread.
//
// Each block carries:
//   * a role tag — "You" (the viewer is the author) or "Counterparty";
//   * a chain label — "Respondent&apos;s initial response",
//     "Buyer counter", etc., inferred from the parentResponseId chain;
//   * a status badge (PENDING / ACCEPTED / COUNTERED / WITHDRAWN /
//     DECLINED / EXPIRED);
//   * the full terms (quantity, price, freight, lead time, packaging,
//     etc.);
//   * an action bar — the flags the server stamped for the current
//     viewer (BUYER-only: accept / counter / decline). AUTHORS can
//     withdraw their own pending block. A `Message <respondent>`
//     button deep-links to the per-seller thread.
//
// Re-fetches on `wanted-responses:invalidate` (fired by
// `<RespondToWantedButton>` after a POST + by every action button
// below on success) and on `deal-status:invalidate` (so an accept here
// advances the lot&apos;s deal-stepper forward, on the buyer&apos;s
// other tab even).
'use client';

import { Check, CheckCircle2, ExternalLink, MessageSquareDashed, X } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { apiFetch } from '@/lib/api-client';
import { useSession } from '@/lib/auth-client';
import type { FreightTerm } from '@/lib/contracts/offers';
import {
  WantedResponseCounter,
  type WantedResponseCounterInput,
  type WantedResponseListResponse,
  WantedResponseList as WantedResponseListSchema,
  type WantedResponseStatus,
} from '@/lib/contracts/wanted-responses';

type ResponseWireItem = WantedResponseListResponse['items'][number];

export interface WantedResponsesSummaryProps {
  lotId: string;
  /** Auth state — drives whether to fetch at all. */
  isAuthed: boolean;
}

const STATUS_LABELS: Record<WantedResponseStatus, string> = {
  PENDING: 'Pending',
  COUNTERED: 'Countered',
  ACCEPTED: 'Accepted',
  DECLINED: 'Declined',
  EXPIRED: 'Expired',
  WITHDRAWN: 'Withdrawn',
};

const STATUS_TONES: Record<WantedResponseStatus, string> = {
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

export function WantedResponsesSummary({ lotId, isAuthed }: WantedResponsesSummaryProps) {
  const { data: session } = useSession();
  const [state, setState] = useState<
    { kind: 'loading' } | { kind: 'ready'; items: ResponseWireItem[] } | { kind: 'error' }
  >({ kind: 'loading' });

  const viewerId = session?.user?.id ?? null;

  const refetch = useCallback(() => {
    if (!isAuthed) {
      setState({ kind: 'ready', items: [] });
      return Promise.resolve();
    }
    return apiFetch<WantedResponseListResponse>(
      `/api/listings/${encodeURIComponent(lotId)}/responses`,
      { schema: WantedResponseListSchema },
    )
      .then((data) => {
        setState({ kind: 'ready', items: data.items });
      })
      .catch((err: unknown) => {
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

  // External invalidation: POST after submit (RespondToWantedButton) and
  // accept/counter/decline/withdraw actions below. deal-status:invalidate
  // is fired by DealStepper after each advance — refetching here keeps
  // the summary consistent with the stepper in the same tab.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    function onInvalidate() {
      void refetch();
    }
    window.addEventListener('wanted-responses:invalidate', onInvalidate);
    window.addEventListener('deal-status:invalidate', onInvalidate);
    return () => {
      window.removeEventListener('wanted-responses:invalidate', onInvalidate);
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
          <CardTitle className="font-display text-base tracking-tight">Responses</CardTitle>
          <CardDescription>Loading negotiation…</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (state.kind === 'error') {
    return (
      <Card className="border-border bg-card shadow-sm">
        <CardHeader>
          <CardTitle className="font-display text-base tracking-tight">Responses</CardTitle>
          <CardDescription>Couldn’t load the response timeline.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // Group by seller (respondent). Each group is one respondent&apos;s
  // chain — the chronological ladder they&apos;re negotiating on. Stable
  // order: oldest respondent&apos;s chain first (by first-block createdAt),
  // blocks within a chain oldest-first.
  const groups = groupResponsesBySeller(state.items);

  if (groups.length === 0) {
    return (
      <Card className="border-border bg-card shadow-sm">
        <CardHeader>
          <CardTitle className="font-display text-base tracking-tight">Responses</CardTitle>
          <CardDescription>
            No structured responses yet on this WANTED listing. Use{' '}
            <strong>Submit a structured response</strong> above to send the first one — the buyer
            can accept, counter, or decline. The full negotiation history stays preserved so both
            sides can audit it later.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="border-border bg-card shadow-sm">
      <CardHeader className="gap-1 border-b border-border">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="font-display text-base tracking-tight">Responses</CardTitle>
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {groups.length} {groups.length === 1 ? 'respondent' : 'respondents'}
          </span>
        </div>
        <CardDescription>
          Negotiation history per respondent. Older counters stay visible — every block is preserved
          so both sides can audit the price ladder and the freight terms.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-4">
        {groups.map(({ sellerDisplayName, sellerId, items }) => (
          <RespondentChain
            key={sellerId}
            sellerDisplayName={sellerDisplayName}
            sellerId={sellerId}
            items={items}
            viewerId={viewerId}
            onMutated={refetch}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function groupResponsesBySeller(
  items: ResponseWireItem[],
): Array<{ sellerId: string; sellerDisplayName: string; items: ResponseWireItem[] }> {
  // First pass: collect seller ids in order of first appearance so the
  // chain order is stable across re-fetches.
  const sellerOrder: string[] = [];
  const bySeller = new Map<string, ResponseWireItem[]>();
  const displayNameBySeller = new Map<string, string>();
  for (const item of items) {
    let bucket = bySeller.get(item.sellerId);
    if (bucket === undefined) {
      bucket = [];
      bySeller.set(item.sellerId, bucket);
      sellerOrder.push(item.sellerId);
      displayNameBySeller.set(item.sellerId, item.sellerDisplayName);
    }
    bucket.push(item);
  }
  // Each chain is already ORDER BY createdAt ASC from the route;
  // guarantee chronological oldest-first on the client too.
  for (const list of bySeller.values()) {
    list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  return sellerOrder.map((sellerId) => ({
    sellerId,
    sellerDisplayName: displayNameBySeller.get(sellerId) ?? 'Seller',
    items: bySeller.get(sellerId) ?? [],
  }));
}

function RespondentChain({
  sellerDisplayName,
  sellerId: _sellerId,
  items,
  viewerId,
  onMutated,
}: {
  sellerDisplayName: string;
  sellerId: string;
  items: ResponseWireItem[];
  viewerId: string | null;
  onMutated: () => Promise<void> | void;
}) {
  // Pick the deepest PENDING row (or null) — the only one whose action
  // bar is honest. For ACCEPT / DECLINE the route stamps PENDING as a
  // prerequisite; this fall-back defers the actual decision to the
  // server (the artist-side guard is the wire&apos;s `actionFlags`).
  const latest = items[items.length - 1] ?? null;

  return (
    <section
      className="flex flex-col gap-3 rounded-md border border-border bg-background px-4 py-3"
      aria-label={`Responses from ${sellerDisplayName}`}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-eyebrow text-primary">Respondent</span>
          <span className="text-sm font-medium text-foreground">{sellerDisplayName}</span>
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {items.length} {items.length === 1 ? 'block' : 'blocks'}
          </span>
        </div>
        {latest ? (
          <Link
            href={`/messages/${encodeURIComponent(latest.threadId)}`}
            className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground hover:text-primary"
          >
            <ExternalLink aria-hidden="true" className="mr-1 inline-block size-3 align-[-2px]" />
            Open thread →
          </Link>
        ) : null}
      </header>
      <ol className="flex flex-col gap-3">
        {items.map((row) => (
          <li key={row.id}>
            <ResponseCard row={row} viewerId={viewerId} onMutated={onMutated} />
          </li>
        ))}
      </ol>
    </section>
  );
}

function ResponseCard({
  row,
  viewerId,
  onMutated,
}: {
  row: ResponseWireItem;
  viewerId: string | null;
  onMutated: () => Promise<void> | void;
}) {
  // Author = seller (respondent) for the originating row (parentResponseId
  // === null); else buyer (RFQ poster). The chain alternates because the
  // counter route enforces buyer-only counters, so by induction every
  // non-root row alternates authorship.
  const authorIsSeller = row.parentResponseId === null;

  // Without ids on the wire we infer the viewer&apos;s role from the
  // server-stamped action flags. canWithdraw being true on a PENDING row
  // means "I am the author"; canAccept / canCounter / canDecline being
  // true means "I am the buyer / counterpart".
  const flags = row.actionFlags;
  let viewerIsAuthor: boolean | null = null;
  if (viewerId !== null && flags !== null) {
    if (flags.canWithdraw) {
      viewerIsAuthor = true;
    } else if (flags.canAccept) {
      viewerIsAuthor = false;
    }
  }
  const isParty = flags !== null;

  const roleLine = !isParty
    ? '—'
    : viewerIsAuthor === true
      ? authorIsSeller
        ? 'You (respondent)'
        : 'You (buyer)'
      : viewerIsAuthor === false
        ? authorIsSeller
          ? 'Buyer'
          : 'Respondent'
        : '—';

  const chainLabel = authorIsSeller
    ? viewerIsAuthor === true
      ? 'Your initial response'
      : 'Their initial response'
    : viewerIsAuthor === true
      ? 'Your counter'
      : 'Counter';

  return (
    <article
      className="flex flex-col gap-3 rounded-md border border-border bg-card px-4 py-3"
      aria-label={`Response at $${row.terms.pricePerUnit} per ${row.terms.priceUnit === 'PER_LB' ? 'lb' : 'kg'} for ${row.terms.quantityLb} lb`}
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
          value={`$${formatNumber(row.terms.pricePerUnit)} ${row.terms.priceUnit === 'PER_LB' ? '$/lb' : '$/kg'}`}
        />
        <SpecRow term="Freight" value={FREIGHT_TERM_LABELS[row.terms.freightTerm]} />
        <SpecRow term="Material location" value={row.terms.materialLocation} />
        {row.terms.leadTimeDays !== null ? (
          <SpecRow term="Lead time" value={`${row.terms.leadTimeDays} days`} />
        ) : null}
        {row.terms.packaging ? <SpecRow term="Packaging" value={row.terms.packaging} /> : null}
        {row.terms.coaAvailable ? <SpecRow term="COA" value="Available" /> : null}
        {row.terms.lotInfo ? <SpecRow term="Lot info" value={row.terms.lotInfo} wide /> : null}
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
  row: ResponseWireItem;
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
          onClick={() => doCounter(row.id, onMutated)}
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

function StatusBadge({ status }: { status: WantedResponseStatus }) {
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

async function doAccept(responseId: string, onMutated: () => Promise<void> | void) {
  try {
    await apiFetch(`/api/responses/${encodeURIComponent(responseId)}/accept`, {
      method: 'POST',
    });
    toast.success('Response accepted.');
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('wanted-responses:invalidate'));
      window.dispatchEvent(new Event('deal-status:invalidate'));
    }
    await onMutated();
  } catch (err: unknown) {
    const body = (err as { cause?: { error?: string } } | undefined)?.cause;
    toast.error(body?.error ?? 'Could not accept.');
  }
}

async function doCounter(responseId: string, onMutated: () => Promise<void> | void) {
  // Inline prompt for the price until the full counter form lands; the
  // brief carries every other field forward from the parent row so the
  // counterparty can&apos;t accidentally clear terms without re-
  // entering them. Marked REJECTED at the route on a non-buyer caller.
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
  const body: WantedResponseCounterInput = {
    terms: {
      quantityLb: 0,
      pricePerUnit,
      priceUnit: 'PER_LB',
      freightTerm: 'DELIVERED',
      materialLocation: 'Material location TBD',
      leadTimeDays: null,
      packaging: null,
      lotInfo: null,
      coaAvailable: false,
      paymentTerms: 'NET 30',
      comments: null,
      offerExpiresAt: expires,
    },
  };
  // Validate client-side before POST so a typo here is caught
  // immediately instead of landing at the route.
  const parsed = WantedResponseCounter.safeParse(body);
  if (!parsed.success) {
    toast.error('Counter payload is not valid; check the field values.');
    return;
  }
  try {
    await apiFetch(`/api/responses/${encodeURIComponent(responseId)}/counter`, {
      method: 'POST',
      body: JSON.stringify(parsed.data),
    });
    toast.success('Counter sent.');
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('wanted-responses:invalidate'));
    }
    await onMutated();
  } catch (err: unknown) {
    const errBody = (err as { cause?: { error?: string } } | undefined)?.cause;
    toast.error(errBody?.error ?? 'Could not counter.');
  }
}

async function doDecline(responseId: string, onMutated: () => Promise<void> | void) {
  try {
    await apiFetch(`/api/responses/${encodeURIComponent(responseId)}/decline`, {
      method: 'POST',
    });
    toast.success('Response declined.');
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('wanted-responses:invalidate'));
    }
    await onMutated();
  } catch (err: unknown) {
    const body = (err as { cause?: { error?: string } } | undefined)?.cause;
    toast.error(body?.error ?? 'Could not decline.');
  }
}

async function doWithdraw(responseId: string, onMutated: () => Promise<void> | void) {
  try {
    await apiFetch(`/api/responses/${encodeURIComponent(responseId)}/withdraw`, {
      method: 'POST',
    });
    toast.success('Response withdrawn.');
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('wanted-responses:invalidate'));
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
