// @polsia:user-owned — single lot card on the /lots browse grid. Whole card is
// a Link to /lots/[id]. Chips come from the lot-chips set so detail and feed
// reads speak the same spec-sheet language.
'use client';

import Link from 'next/link';
import {
  CoaChip,
  ConditionChip,
  CountryChip,
  FormChip,
  HaveChip,
  KgChip,
  PolymerChip,
  PriceChip,
  RecycledChip,
  WantedChip,
} from '@/components/custom/lot-chips';
import {
  conditionLabel,
  formatLb,
  formatPricePerLb,
  polymerLabel,
  relativeAge,
  shortLotId,
} from '@/lib/business/lots';
import type { LotCondition, LotItem, Polymer } from '@/lib/contracts/lots';
import { cn } from '@/lib/utils';

interface LotCardProps {
  lot: LotItem;
}

export function LotCard({ lot }: LotCardProps) {
  const polymer = polymerLabel(lot.polymer as Polymer);
  const condition = conditionLabel(lot.condition as LotCondition);
  const price = formatPricePerLb(lot.askingPricePerLb);
  const shortId = shortLotId(lot);

  const postedBy =
    lot.visibility === 'ANONYMOUS'
      ? 'Meldstock-verified seller'
      : lot.postedByHandle
        ? `@${lot.postedByHandle}`
        : lot.postedByName || 'Anonymous';

  return (
    <Link
      href={`/lots/${lot.id}`}
      aria-label={`Open lot ${shortId}`}
      className="group relative flex h-full flex-col gap-3 overflow-hidden rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm lift"
    >
      {/* Header row: type/polymer chips, short id on the right */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {lot.type === 'HAVE' ? <HaveChip label="HAVE" /> : <WantedChip label="WANTED" />}
          <PolymerChip label={polymer} />
          <ConditionChip label={condition} />
        </div>
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          L-{shortId}
        </span>
      </div>

      {/* Title — manufacturer / grade (if set) or polymer fallback */}
      <h3 className="font-display text-h4 leading-tight tracking-[-0.01em] text-foreground">
        {lot.manufacturer ? (
          <>
            <span className="text-muted-foreground">{lot.manufacturer}</span>
            {lot.grade ? (
              <>
                {' · '}
                <span>{lot.grade}</span>
              </>
            ) : null}
          </>
        ) : (
          `${polymer} · ${lot.condition}`
        )}
      </h3>

      {/* Spec grid (2 cols) */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
        <Spec term="Color" value={lot.color} />
        <Spec term="Form" value={lot.form} />
        <Spec term="Packaging" value={lot.packaging} />
        <Spec term="Country" value={lot.country} />
        <Spec term="Quantity" value={formatLb(lot.quantityLb)} />
        <Spec term="Asking" value={price.label} />
        {lot.location ? <Spec term="Location" value={lot.location} wide /> : null}
      </dl>

      {/* Chips rail */}
      <div className="flex flex-wrap items-center gap-1.5">
        <FormChip label={lot.form} />
        <KgChip label={formatLb(lot.quantityLb)} />
        {lot.country ? <CountryChip label={lot.country} /> : null}
        <PriceChip label={price.label} isPlaceholder={price.isPlaceholder} />
        <CoaChip present={lot.hasCoa} />
        {lot.notes?.toLowerCase().includes('recycled') ? <RecycledChip label="REC" /> : null}
      </div>

      {/* Bottom row — posted-by + relative age + open CTA */}
      <div className="mt-auto flex items-center justify-between gap-3 border-t border-border pt-3">
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {postedBy}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            posted {relativeAge(lot.createdAt)} ago
          </span>
        </div>
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground',
          )}
        >
          Open lot →
        </span>
      </div>
    </Link>
  );
}

function Spec({ term, value, wide }: { term: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2' : undefined}>
      <dt className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
        {term}
      </dt>
      <dd className="truncate text-foreground">{value}</dd>
    </div>
  );
}
