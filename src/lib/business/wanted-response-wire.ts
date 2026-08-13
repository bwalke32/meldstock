// @polsia:user-owned — WantedResponse row → wire shape. Used by every
// route that returns a WantedResponse (POST/GET on both
// `/api/listings/[id]/responses` and the inner
// `/api/responses/[id]/*`). Centralises:
//   * Decimal → string coercion (same pattern as OfferWire);
//   * server-stamped `actionFlags` so the summary timeline renders the
//     accept / counter / decline / withdraw buttons without a second
//     round-trip;
//   * display-name resolution for BOTH the buyer (RFQ poster) and the
//     seller (respondent) so the timeline card shows the role label
//     without a follow-up fetch.
//
// Action-flag semantics OVERLOADED vs offer-wire: per the brief, on a
// WANTED listing the BUYER (= RFQ poster) accepts / counters / declines
// — deliberate inversion from the HAVE Offer flow where the SELLER
// counters. canWithdraw follows author parity: SELLER on root rows,
// BUYER on counter rows.
//
// Server-only — imports `prisma` and is only called from `/api`.
import 'server-only';
import type { WantedResponseItem, WantedResponseStatus } from '@/lib/contracts/wanted-responses';

type WantedResponseRow = {
  id: string;
  threadId: string;
  lotId: string;
  buyerId: string;
  sellerId: string;
  parentResponseId: string | null;
  status: WantedResponseStatus;
  quantityLb: unknown;
  pricePerUnit: unknown;
  priceUnit: string;
  freightTerm: string;
  materialLocation: string;
  leadTimeDays: number | null;
  packaging: string | null;
  lotInfo: string | null;
  coaAvailable: boolean;
  paymentTerms: string | null;
  comments: string | null;
  offerExpiresAt: Date;
  createdAt: Date;
  counteredAt: Date | null;
  acceptedAt: Date | null;
  declinedAt: Date | null;
  withdrawnAt: Date | null;
};

type WantedResponseWireFlags = NonNullable<WantedResponseItem['actionFlags']>;

export async function createWantedResponseWireFromRow(
  row: WantedResponseRow,
  viewerId: string,
): Promise<WantedResponseItem> {
  const [buyerProfile, sellerProfile] = await Promise.all([
    safeProfileFind(row.buyerId),
    safeProfileFind(row.sellerId),
  ]);

  // Action flags only meaningful when viewer is on the row — null
  // otherwise so the UI doesn't render an ambiguous button.
  const flags = computeActionFlags(row, viewerId);

  return {
    id: row.id,
    threadId: row.threadId,
    lotId: row.lotId,
    sellerId: row.sellerId,
    buyerId: row.buyerId,
    buyerDisplayName: buyerProfile?.displayName ?? 'Buyer',
    sellerDisplayName: sellerProfile?.displayName ?? 'Seller',
    parentResponseId: row.parentResponseId,
    status: row.status,
    terms: {
      quantityLb: decimalToString(row.quantityLb),
      pricePerUnit: decimalToString(row.pricePerUnit),
      priceUnit: row.priceUnit === 'PER_KG' ? 'PER_KG' : 'PER_LB',
      freightTerm: row.freightTerm as WantedResponseItem['terms']['freightTerm'],
      materialLocation: row.materialLocation,
      leadTimeDays: row.leadTimeDays,
      packaging: row.packaging,
      lotInfo: row.lotInfo,
      coaAvailable: row.coaAvailable,
      paymentTerms: row.paymentTerms,
      comments: row.comments,
      offerExpiresAt: row.offerExpiresAt.toISOString(),
    },
    createdAt: row.createdAt.toISOString(),
    offerExpiresAt: row.offerExpiresAt.toISOString(),
    counteredAt: row.counteredAt?.toISOString() ?? null,
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    declinedAt: row.declinedAt?.toISOString() ?? null,
    withdrawnAt: row.withdrawnAt?.toISOString() ?? null,
    actionFlags: flags,
  };
}

/**
 * Action-flag derivation for the WANTED-reply side. The plan's rules:
 *   canAccept / canDecline / canCounter — true iff caller is the BUYER
 *     (= RFQ poster) on a PENDING row. The plan explicitly inverts the
 *     HAVE Offer flow here: the buyer of a WANTED listing owns accept /
 *     decline / counter; they are the counterpart of the seller-respondent.
 *   canWithdraw  — true iff caller is the AUTHOR of a PENDING row.
 *     Author = seller (= respondent) for root rows (parentResponseId ===
 *     null), else the buyer (= RFQ poster) for counter rows. Counters
 *     strictly alternate by induction since the buyer-only counter rule
 *     rejects the seller trying to reframe.
 *
 * Non-parties get null. The action routes further validate (409 on a
 * non-PENDING row, 403 on a wrong-party accept) — these flags are only
 * the rendering signal, not the authorisation layer.
 */
function computeActionFlags(
  row: WantedResponseRow,
  viewerId: string,
): WantedResponseWireFlags | null {
  const isBuyer = row.buyerId === viewerId;
  const isSeller = row.sellerId === viewerId;
  if (!isBuyer && !isSeller) {
    return null;
  }
  const isPending = row.status === 'PENDING';
  if (!isPending) {
    return {
      canAccept: false,
      canCounter: false,
      canDecline: false,
      canWithdraw: false,
    };
  }
  // Author = seller (= respondent) for root responses (parentResponseId
  // === null). Buyer counters are buyer-owned by construction; the chain
  // alternates seller → buyer → seller → buyer.
  const authorIsSeller = row.parentResponseId === null;
  const authorIsBuyer = !authorIsSeller;
  return {
    canAccept: isBuyer,
    canCounter: isBuyer,
    canDecline: isBuyer,
    canWithdraw: (isSeller && authorIsSeller) || (isBuyer && authorIsBuyer),
  };
}

// Pulled out so the wire helper can stay free of `prisma` imports at the
// body level — keeps the file lint-clean and matches the pattern in
// offer-wire.ts.
async function safeProfileFind(userId: string): Promise<{ displayName: string } | null> {
  try {
    const { prisma } = await import('@/lib/db');
    const row = await prisma.profile.findUnique({
      where: { userId },
      select: { displayName: true },
    });
    return row ? { displayName: row.displayName } : null;
  } catch {
    return null;
  }
}

function decimalToString(v: unknown): string {
  if (v === null || v === undefined) return '0';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return v.toString();
  return (v as { toString(): string }).toString();
}
