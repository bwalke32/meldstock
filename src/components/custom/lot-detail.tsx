// @polsia:user-owned — client island for /lots/[id]. Fetches the lot + thread
// + documents from a single endpoint and renders the trading-desk spec sheet
// + private message thread + download links for attached PDFs.
//
// On HAVE listings the page mounts the structured offer flow: a
// `<MakeOfferButton>` plus the existing legacy `MessageSellerButton`
// (both stay additive), followed by an `<OfferThread>` below the spec
// sheet showing the full negotiation history.
//
// On WANTED listings the structured seller-response flow mirrors the
// HAVE flow: a `<RespondToWantedButton>` (visible to non-posters
// only) plus a `<WantedResponsesSummary>` below the spec sheet
// showing every respondent chain with the buyer-side action bar.
// Anonymous viewers and the lot poster fall back to the existing per-
// lot free-text LotMessageThread.
'use client';

import { FileText } from 'lucide-react';
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
import { LotComparables } from '@/components/custom/lot-comparables';
import { LotPriceTrend } from '@/components/custom/lot-price-trend';
import { DealStepper } from '@/components/custom/messages/DealStepper';
import { MessageSellerButton } from '@/components/custom/messages/message-seller-button';
import { MakeOfferButton } from '@/components/custom/offers/MakeOfferButton';
import { OfferThread } from '@/components/custom/offers/OfferThread';
import { RespondToWantedButton } from '@/components/custom/rfq/RespondToWantedButton';
import { WantedResponsesSummary } from '@/components/custom/rfq/WantedResponsesSummary';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { apiFetch } from '@/lib/api-client';
import { useSession } from '@/lib/auth-client';
import {
  conditionLabel,
  formatLb,
  formatPricePerLb,
  formatTimestamp,
  polymerLabel,
  shortLotId,
} from '@/lib/business/lots';
import {
  type LotCondition,
  type LotDetailResponse,
  LotDetailResponse as LotDetailResponseSchema,
  type Polymer,
} from '@/lib/contracts/lots';
import { LotDealStatusResponse as LotDealStatusResponseSchema } from '@/lib/contracts/messaging';

type State =
  | { kind: 'loading' }
  | { kind: 'not-found' }
  | { kind: 'error' }
  | {
      kind: 'ready';
      lot: LotDetailResponse['lot'];
      messages: LotDetailResponse['messages'];
      documents: LotDetailResponse['documents']['items'];
      // The caller's own active-thread stepper (null when the viewer has
      // no participating thread with this lot — anonymous listings,
      // anonymous viewer, or seller viewing own lot with no buyer
      // thread yet). Fetched separately from /api/lots/[id]/deal-status
      // and re-fetched on `deal-status:invalidate` so a seller's open
      // lot page ticks forward without a manual reload.
      dealStatusBlock: NonNullable<LotDetailResponse['dealStatusBlock']> | null;
    };

// Human-readable labels for DocumentType in the spec-sheet Documents row +
// per-row chip. Kept here so the read view speaks the same language as
// the uploader's dropdown.
const DOCUMENT_TYPE_LABELS: Record<
  LotDetailResponse['documents']['items'][number]['type'],
  string
> = {
  COA: 'COA',
  TDS: 'TDS',
  SDS: 'SDS',
  CERTIFICATION: 'CERT',
  TEST_REPORT: 'TEST',
  OTHER: 'OTHER',
};

export function LotDetail({ id }: { id: string }) {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let active = true;
    apiFetch(`/api/lots/${encodeURIComponent(id)}`, { schema: LotDetailResponseSchema })
      .then((data) => {
        if (!active) return;
        // First paint — null until the deal-status block resolves below
        // (separate endpoint + separate zod schema).
        setState({
          kind: 'ready',
          lot: data.lot,
          messages: data.messages,
          documents: data.documents.items,
          dealStatusBlock: null,
        });
      })
      .catch((err: unknown) => {
        if (!active) {
          return;
        }
        const status = err instanceof Error ? /\((\d{3})\)/.exec(err.message)?.[1] : undefined;
        if (status === '404') {
          setState({ kind: 'not-found' });
        } else {
          setState({ kind: 'error' });
        }
      });
    return () => {
      active = false;
    };
  }, [id]);

  // Fetch the caller's own deal stepper for this lot. Fire-and-forget
  // on initial mount so the primary GET's render path is unaffected by
  // a no-thread viewer / 401 / blocked-network response — the spec sheet
  // stays the source of truth while the stepper resolves in the
  // background. Swallow all errors silently: a viewer without a
  // participating thread is the dominant case and must render `null`
  // without a console stack trace.
  useEffect(() => {
    let active = true;
    apiFetch(`/api/lots/${encodeURIComponent(id)}/deal-status`, {
      schema: LotDealStatusResponseSchema,
    })
      .then((data) => {
        if (!active) return;
        setState((prev) => {
          if (prev.kind !== 'ready') return prev;
          return { ...prev, dealStatusBlock: data.dealStatusBlock };
        });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [id]);

  // Subscribe to the same deal-status:invalidate bus the <DealStepper/>
  // dispatcher fires. Lets a seller's own open lot detail page tick
  // forward after their own PATCH (the lot endpoint doesn't subscribe
  // via header events, only via the strip's `onAdvance` callback).
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    function refetch() {
      apiFetch(`/api/lots/${encodeURIComponent(id)}/deal-status`, {
        schema: LotDealStatusResponseSchema,
      })
        .then((data) => {
          setState((prev) => {
            if (prev.kind !== 'ready') return prev;
            return { ...prev, dealStatusBlock: data.dealStatusBlock };
          });
        })
        .catch(() => undefined);
    }
    window.addEventListener('deal-status:invalidate', refetch);
    return () => window.removeEventListener('deal-status:invalidate', refetch);
  }, [id]);

  if (state.kind === 'loading') {
    return (
      <Card className="border-border bg-card">
        <CardContent className="py-10 text-sm text-muted-foreground">Loading lot…</CardContent>
      </Card>
    );
  }

  if (state.kind === 'not-found') {
    return (
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="font-display text-lg tracking-tight">Lot not found</CardTitle>
          <CardDescription>
            No listing matches the id in the URL. It may have been removed, or the link is wrong.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" size="sm">
            <Link href="/post-a-lot">Post a lot →</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (state.kind === 'error') {
    return (
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="font-display text-lg tracking-tight">
            Couldn’t load this lot
          </CardTitle>
          <CardDescription>Try again in a moment.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" size="sm">
            <Link href="/trading-floor">Back to the floor →</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <LotReady lot={state.lot} documents={state.documents} dealStatusBlock={state.dealStatusBlock} />
  );
}

function LotReady({
  lot,
  documents,
  dealStatusBlock,
}: {
  lot: LotDetailResponse['lot'];
  documents: LotDetailResponse['documents']['items'];
  dealStatusBlock: NonNullable<LotDetailResponse['dealStatusBlock']> | null;
}) {
  const { data: session } = useSession();
  const isAuthed = session?.user?.id !== undefined;
  const lotSummary = `${lot.polymer} · ${lot.manufacturer ?? ''} ${lot.grade ?? ''}`.trim();
  const shortId = shortLotId(lot);
  const created = new Date(lot.createdAt);
  const timePosted = formatTimestamp(lot.createdAt);
  const polymer = polymerLabel(lot.polymer as Polymer);
  const condition = conditionLabel(lot.condition as LotCondition);
  const price = formatPricePerLb(lot.askingPricePerLb);
  const isHAVE = lot.type === 'HAVE';
  const isWanted = !isHAVE;

  // Summary for the spec-sheet "Documents" row. When the lot carries no
  // Document rows (legacy lots, no upload), fall back to the boolean so
  // older listings still read sensibly without inventing a Documents row
  // that doesn't exist in the DB.
  const documentsSummary =
    documents.length === 0
      ? lot.hasCoa
        ? 'Yes'
        : 'No'
      : `${documents.length} attached (${documents
          .map((d) => DOCUMENT_TYPE_LABELS[d.type])
          .join(', ')})`;

  return (
    <div className="flex flex-col gap-6">
      <LotPriceTrend
        lotId={lot.id}
        polymer={lot.polymer as Polymer}
        grade={lot.grade}
        askingPricePerLb={lot.askingPricePerLb}
      />
      {/* Deal-progress card — visible only when the viewer has an
          active thread with this lot's seller that the standalone
          deal-status endpoint could resolve. Anonymous lots, the lot
          seller viewing their own listing with no buyer thread, and
          viewers with no participating thread all resolve to `null`
          and the card slips out of the layout cleanly. */}
      {dealStatusBlock ? (
        <DealStepper
          threadId={dealStatusBlock.threadId}
          dealStatus={dealStatusBlock.dealStatus}
          canAdvance={dealStatusBlock.canAdvance}
          dealStatusUpdatedAt={dealStatusBlock.dealStatusUpdatedAt}
          footer={
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild variant="ghost" size="sm">
                <Link href={`/dashboard/messages?thread=${dealStatusBlock.threadId}`}>
                  Open thread →
                </Link>
              </Button>
            </div>
          }
        />
      ) : null}
      <Card className="border-border bg-card shadow-sm">
        <CardHeader className="gap-2 border-b border-border">
          <div className="flex items-center justify-between gap-3">
            <span className="text-eyebrow text-primary">Lot L-{shortId}</span>
            <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              <span className="relative flex h-2 w-2">
                <span className="absolute inset-0 inline-flex h-2 w-2 live-dot-ping rounded-full bg-primary/50" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
              </span>
              posted {timePosted}
            </span>
          </div>
          <CardTitle className="font-display text-h3 leading-tight tracking-[-0.02em] text-foreground">
            {lot.manufacturer ? (
              <>
                <span className="text-muted-foreground">{lot.manufacturer}</span>
                {' · '}
                <span>{lot.grade || polymer}</span>
              </>
            ) : (
              polymer
            )}
          </CardTitle>
          <CardDescription>
            Posted by{' '}
            {/* Broker-attached posters link to the broker marketing page
                (`/brokers/<userId>`); non-broker sellers keep the legacy
                `/u/<handle>` link. ANONYMOUS / no-profile lots render the
                plain name without a link. The discriminator is the new
                `postedByIsBroker` flag stamped on the lot wire by
                /api/lots/[id]. */}
            {lot.postedByHandle && lot.postedByUserId && !lot.postedByIsBroker ? (
              <Button
                asChild
                variant="link"
                size="sm"
                className="h-auto px-0 text-body font-medium"
              >
                <Link href={`/u/${lot.postedByHandle}`}>{lot.postedByName}</Link>
              </Button>
            ) : lot.postedByIsBroker && lot.postedByUserId ? (
              <Button
                asChild
                variant="link"
                size="sm"
                className="h-auto px-0 text-body font-medium"
              >
                <Link href={`/brokers/${encodeURIComponent(lot.postedByUserId)}`}>
                  {lot.postedByName}
                </Link>
              </Button>
            ) : (
              <span className="font-medium text-foreground">{lot.postedByName}</span>
            )}{' '}
            · {created.toLocaleDateString(undefined, { dateStyle: 'medium' })}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5 pt-5">
          <div className="flex flex-wrap items-center gap-1.5">
            {lot.type === 'HAVE' ? <HaveChip label="HAVE" /> : <WantedChip label="WANTED" />}
            <PolymerChip label={polymer} />
            <ConditionChip label={condition} />
            <FormChip label={lot.form} />
            <KgChip label={formatLb(lot.quantityLb)} />
            {lot.country ? <CountryChip label={lot.country} /> : null}
            <PriceChip label={price.label} isPlaceholder={price.isPlaceholder} />
            <CoaChip present={lot.hasCoa} />
          </div>

          <dl className="grid grid-cols-1 gap-y-3 rounded-md border border-border bg-muted/30 px-4 py-4 text-sm sm:grid-cols-2">
            <SpecRow term="Lot id" value={lot.id} mono />
            <SpecRow term="Type" value={lot.type} />
            <SpecRow term="Polymer" value={`${polymer} · ${lot.polymer}`} />
            <SpecRow term="Condition" value={condition} />
            <SpecRow term="Color" value={lot.color} />
            <SpecRow term="Form" value={lot.form} />
            <SpecRow term="Manufacturer" value={lot.manufacturer ?? '—'} />
            <SpecRow term="Grade" value={lot.grade ?? '—'} />
            <SpecRow term="Quantity" value={formatLb(lot.quantityLb)} />
            <SpecRow term="Packaging" value={lot.packaging} />
            <SpecRow term="Country" value={lot.country || '—'} />
            <SpecRow term="Location" value={lot.location ?? '—'} />
            <SpecRow term="Asking price" value={price.label} wide />
            <SpecRow term="Documents" value={documentsSummary} wide />
            <SpecRow term="Notes" value={lot.notes ?? '—'} wide />
          </dl>

          {/* Documents panel — sibling of the dl, inside the same Card. Hidden
              when there are no Document rows so the spec sheet doesn't show
              "No documents attached" for lots that genuinely have none. */}
          {documents.length > 0 ? (
            <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/30 px-4 py-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                  Attached documents
                </span>
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {documents.length} / 5
                </span>
              </div>
              <ul className="flex flex-col divide-y divide-border">
                {documents.map((d) => (
                  <li key={d.id} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
                    <FileText className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                    <span className="inline-flex min-w-0 flex-1 items-center gap-2">
                      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                        {DOCUMENT_TYPE_LABELS[d.type]}
                      </span>
                      <span
                        className="min-w-0 flex-1 truncate text-sm text-foreground"
                        title={d.filename}
                      >
                        {d.filename}
                      </span>
                    </span>
                    <a
                      href={d.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px] uppercase tracking-wider text-foreground transition-colors hover:border-primary hover:text-primary"
                      download={d.filename}
                    >
                      Download ↗
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <MessageSellerButton
              lotId={lot.id}
              sellerUserId={lot.postedByUserId}
              postedByName={lot.postedByName}
            />
            {isHAVE && lot.postedByUserId ? (
              <MakeOfferButton
                lotId={lot.id}
                sellerUserId={lot.postedByUserId}
                postedByName={lot.postedByName}
                lotSummary={lotSummary}
              />
            ) : null}
            {isWanted && lot.postedByUserId ? (
              <RespondToWantedButton
                lotId={lot.id}
                postedByUserId={lot.postedByUserId}
                postedByName={lot.postedByName}
                lotSummary={lotSummary}
              />
            ) : null}
            {/* "View seller profile" flips to "Broker profile →" when the
                poster is broker-attached (matches the seller line above). */}
            {lot.postedByIsBroker && lot.postedByUserId ? (
              <Button asChild variant="outline" size="sm">
                <Link href={`/brokers/${encodeURIComponent(lot.postedByUserId)}`}>
                  Broker profile →
                </Link>
              </Button>
            ) : lot.postedByHandle && lot.postedByUserId ? (
              <Button asChild variant="outline" size="sm">
                <Link href={`/u/${lot.postedByHandle}`}>View seller profile →</Link>
              </Button>
            ) : null}
            <Button asChild variant="outline" size="sm">
              <Link href="/trading-floor">Back to trading floor →</Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/post-a-lot">Post another lot →</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      {isHAVE ? <OfferThread lotId={lot.id} isAuthed={isAuthed} /> : null}
      {isWanted ? <WantedResponsesSummary lotId={lot.id} isAuthed={isAuthed} /> : null}

      <LotComparables excludeId={lot.id} polymer={lot.polymer as Polymer} grade={lot.grade} />
    </div>
  );
}

function SpecRow({
  term,
  value,
  mono,
  wide,
}: {
  term: string;
  value: string;
  mono?: boolean;
  wide?: boolean;
}) {
  return (
    <div className={wide ? 'sm:col-span-2' : undefined}>
      <dt className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        {term}
      </dt>
      <dd className={mono ? 'font-mono text-foreground' : 'text-foreground'}>{value}</dd>
    </div>
  );
}
