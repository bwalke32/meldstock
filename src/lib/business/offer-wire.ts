// @polsia:user-owned — offer row → OfferItem wire shape. Used by every
// route that returns an Offer (POST/GET on both `/api/listings/[id]/offers`
// and the inner `/api/offers/[id]/*`). Centralises:
//   * Decimal → string coercion (same pattern as LotItem);
//   * server-stamped `actionFlags` so the client timeline can render the
//     accept / counter / decline / withdraw buttons without a second
//     round-trip;
//   * display-name resolution for BOTH the buyer and the seller (so the
//     timeline card can show "You · seller counter" without a follow-up
//     fetch).
//
// Server-only — imports `prisma` and is only called from `/api`.
import 'server-only';
import type { OfferItem, OfferStatus } from '@/lib/contracts/offers';

type OfferRow = {
  id: string;
  threadId: string;
  lotId: string;
  buyerId: string;
  sellerId: string;
  parentOfferId: string | null;
  status: OfferStatus;
  quantityLb: unknown;
  pricePerUnit: unknown;
  priceUnit: string;
  freightTerm: string;
  shipToZipCode: string | null;
  shipToCity: string | null;
  shipToState: string | null;
  shipToCountry: string | null;
  requestedDeliveryDate: Date | null;
  paymentTerms: string | null;
  comments: string | null;
  offerExpiresAt: Date;
  createdAt: Date;
  counteredAt: Date | null;
  acceptedAt: Date | null;
  declinedAt: Date | null;
  withdrawnAt: Date | null;
};

type OfferWireFlags = NonNullable<OfferItem['actionFlags']>;

export async function createOfferWireFromRow(row: OfferRow, viewerId: string): Promise<OfferItem> {
  const [buyerProfile, sellerProfile] = await Promise.all([
    safeProfileFind(row.buyerId),
    safeProfileFind(row.sellerId),
  ]);

  // action flags only meaningful when viewer is on the row — null otherwise
  // so the UI doesn't render an ambiguous button.
  const flags = computeActionFlags(row, viewerId);

  return {
    id: row.id,
    threadId: row.threadId,
    lotId: row.lotId,
    buyerDisplayName: buyerProfile?.displayName ?? 'Buyer',
    sellerDisplayName: sellerProfile?.displayName ?? 'Seller',
    parentOfferId: row.parentOfferId,
    status: row.status,
    terms: {
      quantityLb: decimalToString(row.quantityLb),
      pricePerUnit: decimalToString(row.pricePerUnit),
      priceUnit: row.priceUnit === 'PER_KG' ? 'PER_KG' : 'PER_LB',
      freightTerm: row.freightTerm as OfferItem['terms']['freightTerm'],
      shipToZipCode: row.shipToZipCode,
      shipToCity: row.shipToCity,
      shipToState: row.shipToState,
      shipToCountry: row.shipToCountry,
      requestedDeliveryDate: row.requestedDeliveryDate?.toISOString() ?? null,
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
 * Action-flag derivation. The plan's rules:
 *   canCounter   — true iff caller is the SELLER on a PENDING row (the
 *                  plan constrains COUNTER to seller-only — buyer can
 *                  always withdraw + start a fresh thread by submitting
 *                  a new offer, so they don't need a counter path).
 *   canWithdraw  — true iff caller is the AUTHOR of a PENDING row
 *                  (author = buyer if parentOfferId is null, else the
 *                  seller — counter is seller-only per the plan, so
 *                  authors strictly alternate).
 *   canAccept    — true iff caller is the COUNTERPART of the author on a
 *                  PENDING row (the worked example is "buyer accepts
 *                  seller's counter").
 *   canDecline   — same as canAccept — the counterpart who hasn't yet
 *                  moved the deal can decline.
 *
 * Non-parties get null. The action routes further validate (409 on a
 * non-PENDING row, 403 on a wrong-party accept) — these flags are only
 * the rendering signal, not the authorisation layer.
 */
function computeActionFlags(row: OfferRow, viewerId: string): OfferWireFlags | null {
  const isBuyer = row.buyerId === viewerId;
  const isSeller = row.sellerId === viewerId;
  if (!isBuyer && !isSeller) {
    return null;
  }
  const isPending = row.status === 'PENDING';
  if (!isPending) {
    return { canCounter: false, canWithdraw: false, canAccept: false, canDecline: false };
  }
  // Author = buyer for the originating row (parentOfferId === null); for
  // counter rows the route only ever stamps a seller-authored parent,
  // so by induction every node alternates authorship and the child is
  // ALWAYS seller-authored iff the parent has a parentOfferId.
  const authorIsBuyer = row.parentOfferId === null;
  const authorIsSeller = !authorIsBuyer;
  return {
    canCounter: isSeller,
    canWithdraw: (isBuyer && authorIsBuyer) || (isSeller && authorIsSeller),
    canAccept: (isSeller && authorIsBuyer) || (isBuyer && authorIsSeller),
    canDecline: (isSeller && authorIsBuyer) || (isBuyer && authorIsSeller),
  };
}

// Pulled out so the wire helper can stay free of `prisma` imports at the
// body level — keeps the file lint-clean and matches the pattern in the
// lot-comparables helper.
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
