// @polsia:user-owned — comparable-lots panel. Client island that fetches
// `/api/lots/[id]/comparables` (other lots matching the same polymer, with
// grade / quantity band / continent scoring in the API) and renders a
// responsive mini-card grid linking each row to its /lots/[id] detail page.
// Three columns on `lg`, two on `sm`, one on mobile.
'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ConditionChip, GradeChip, HaveChip, WantedChip } from '@/components/custom/lot-chips';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { apiFetch } from '@/lib/api-client';
import {
  conditionLabel,
  formatLb,
  formatPricePerLb,
  polymerLabel,
  shortLotId,
} from '@/lib/business/lots';
import {
  type LotCondition,
  type LotList,
  LotList as LotListSchema,
  type Polymer,
} from '@/lib/contracts/lots';

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; items: LotList['items'] }
  | { kind: 'error' }
  | { kind: 'empty' };

interface LotComparablesProps {
  excludeId: string;
  polymer: Polymer;
  grade: string | null;
}

export function LotComparables({ excludeId, polymer, grade }: LotComparablesProps) {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let active = true;
    apiFetch(`/api/lots/${encodeURIComponent(excludeId)}/comparables`, { schema: LotListSchema })
      .then((data) => {
        if (!active) {
          return;
        }
        setState(
          data.items.length === 0 ? { kind: 'empty' } : { kind: 'ready', items: data.items },
        );
      })
      .catch(() => {
        if (active) {
          setState({ kind: 'error' });
        }
      });
    return () => {
      active = false;
    };
  }, [excludeId]);

  return (
    <Card className="border-border bg-card shadow-sm">
      <CardHeader className="gap-1 border-b border-border">
        <div className="flex items-center justify-between gap-3">
          <span className="text-eyebrow text-primary">Comparable lots</span>
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            same {polymerLabel(polymer)}
            {grade ? ` · ${grade}` : ''}
          </span>
        </div>
        <CardTitle className="font-display text-lg tracking-tight text-foreground">
          Other listings worth comparing
        </CardTitle>
        <CardDescription>
          Same polymer, similar grade, comparable quantity band, shared continent — useful as a
          price-and-spec sanity check before you make an offer.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-5">
        {state.kind === 'loading' ? <Skeleton /> : null}
        {state.kind === 'empty' ? <EmptyState /> : null}
        {state.kind === 'error' ? <ErrorState /> : null}
        {state.kind === 'ready' ? <Grid items={state.items} /> : null}
      </CardContent>
    </Card>
  );
}

function Grid({ items }: { items: LotList['items'] }) {
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((lot) => (
        <li key={lot.id} className="h-full">
          <ComparableCard lot={lot} />
        </li>
      ))}
    </ul>
  );
}

function ComparableCard({ lot }: { lot: LotList['items'][number] }) {
  const polymer = polymerLabel(lot.polymer as Polymer);
  const shortId = shortLotId(lot);
  const condition = conditionLabel(lot.condition as LotCondition);
  const price = formatPricePerLb(lot.askingPricePerLb);
  const quantity = formatLb(lot.quantityLb);
  const locationLine =
    lot.location && lot.country
      ? `${lot.location}, ${lot.country}`
      : (lot.location ?? lot.country ?? null);

  return (
    <Link
      href={`/lots/${lot.id}`}
      aria-label={`Open lot ${shortId}`}
      className="group flex h-full flex-col gap-3 rounded-md border border-border bg-background p-3 transition-colors hover:border-primary/40 hover:bg-muted/40"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1">
          {lot.type === 'HAVE' ? <HaveChip label="HAVE" /> : <WantedChip label="WANTED" />}
          <ConditionChip label={condition} />
        </div>
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          L-{shortId}
        </span>
      </div>

      <div className="flex flex-col gap-0.5">
        <h4 className="line-clamp-1 text-[13px] font-medium leading-tight text-foreground">
          {polymer}
          {lot.manufacturer ? ` · ${lot.manufacturer}` : ''}
        </h4>
        <p className="line-clamp-1 text-[11px] text-muted-foreground">
          {lot.color} · {lot.form} · {lot.packaging}
        </p>
      </div>

      <RowFields
        grade={lot.grade}
        condition={condition}
        quantity={quantity}
        price={price.label}
        location={locationLine}
        isPricePlaceholder={price.isPlaceholder}
      />
    </Link>
  );
}

function RowFields({
  grade,
  condition,
  quantity,
  price,
  location,
  isPricePlaceholder,
}: {
  grade: string | null;
  condition: string;
  quantity: string;
  price: string;
  location: string | null;
  isPricePlaceholder: boolean;
}) {
  return (
    <dl className="mt-auto grid grid-cols-2 gap-x-3 gap-y-2 border-t border-border pt-2 text-[11px]">
      <Field term="Grade">
        {grade ? <GradeChip label={grade} /> : <span className="text-muted-foreground">—</span>}
      </Field>
      <Field term="Condition">{condition}</Field>
      <Field term="Quantity">{quantity}</Field>
      <Field term="Price">
        <span className={isPricePlaceholder ? 'italic text-muted-foreground' : 'text-foreground'}>
          {price}
        </span>
      </Field>
      {location ? (
        <Field term="Location" wide>
          {location}
        </Field>
      ) : null}
    </dl>
  );
}

function Field({
  term,
  children,
  wide,
}: {
  term: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={wide ? 'col-span-2' : undefined}>
      <dt className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        {term}
      </dt>
      <dd className="leading-tight text-foreground">{children}</dd>
    </div>
  );
}

function Skeleton() {
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
      {['comp-skel-1', 'comp-skel-2', 'comp-skel-3'].map((key) => (
        <li
          key={key}
          className="h-[170px] animate-pulse rounded-md border border-border bg-muted/40"
        />
      ))}
    </ul>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-start gap-1 rounded-md border border-dashed border-border bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
      <span className="font-medium text-foreground">No comparable listings right now.</span>
      <span>Be the first to set the price on this polymer — post a lot.</span>
    </div>
  );
}

function ErrorState() {
  return (
    <div className="rounded-md border border-dashed border-border bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
      Comparable lots are temporarily unavailable.
    </div>
  );
}
