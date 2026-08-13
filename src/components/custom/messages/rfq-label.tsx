// @polsia:user-owned — shared "RFQ: <grade>/<quantityLb>/<location>" pill.
// Imported by the dashboard inbox row, the legacy /messages inbox row, the
// thread header, and the unread-messages card so the same string appears in
// every "a WANTED-origin thread" surface. Wraps the whole thing in a
// `<Link>` so the buyer can click the pill back to the source listing and
// re-check its current specs.
//
// Pure client component (textarea → JSX); no server-only deps. The `href`
// is the `/lots/<id>` back-link target. `quantityLb` and `location` may be
// missing on a degraded lot row — those branches fall back to "—" so the
// pill is always well-formed.
'use client';

import Link from 'next/link';
import { formatLb } from '@/lib/business/lots';
import type { RfqPreview } from '@/lib/contracts/messages-unread';
import type { RfqContext } from '@/lib/contracts/messaging';

export interface RfqLabelProps {
  rfq: RfqContext | RfqPreview;
  // Decorative only — separating "row leading label" from the standalone
  // header variant means a single component covers the inbox UNREAD pill
  // (RfqPreview, no back-link) and the richer thread-header variant
  // (RfqContext — pill with back-link + Wanted badge). Default: link=true
  // (the ThreadItem path, which is what every surface except the unread
  // widget uses).
  withLink?: boolean;
}

export function RfqLabel({ rfq, withLink = true }: RfqLabelProps) {
  const grade = readGrade(rfq);
  const quantity = readQuantity(rfq);
  const location = readLocation(rfq);
  const lotId = 'lot' in rfq ? rfq.lot.id : '';
  const content = (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-wider text-primary">
        RFQ: {grade}/{quantity}/{location}
      </span>
      <span
        className="inline-flex items-center rounded-full border border-primary/40 bg-primary/10 px-1.5 py-px text-[9px] font-mono uppercase tracking-wider text-primary"
        title="This thread was opened from a WANTED listing."
      >
        Wanted
      </span>
    </span>
  );
  if (!withLink || lotId.length === 0) {
    return content;
  }
  return (
    <Link
      href={`/lots/${lotId}`}
      className="inline-flex min-w-0 items-center gap-1.5 rounded outline-none transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary"
      title={`Open listing — RFQ ${grade}/${quantity}/${location}`}
    >
      {content}
    </Link>
  );
}

function readGrade(r: RfqContext | RfqPreview): string {
  if ('lot' in r) return r.lot.grade ?? '—';
  return r.grade ?? '—';
}

function readQuantity(r: RfqContext | RfqPreview): string {
  if ('lot' in r) return formatLb(r.lot.quantityLb);
  return formatLb(r.quantityLb);
}

function readLocation(r: RfqContext | RfqPreview): string {
  if ('lot' in r) return r.lot.location ?? '—';
  return r.location ?? '—';
}
