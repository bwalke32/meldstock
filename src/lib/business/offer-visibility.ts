// @polsia:user-owned — offer visibility gate. Reused by every route under
// /api/listings/[id]/offers/* and /api/offers/[id]/* so access is
// answered identically across the resource. Existence is hidden on a
// 404 / 403 — never an existence-leak via 200 with an empty list.
//
// Server-only — imports `NextResponse`; only API handlers touch it.
import 'server-only';
import { NextResponse } from 'next/server';

export type OfferLike = {
  id: string;
  lotId: string;
  threadId: string;
  buyerId: string;
  sellerId: string;
};

/**
 * Predicate: is `userId` the buyer, the seller, or otherwise an authorised
 * party on this offer row? Returned counts are purely "on this row" — does
 * NOT consult the thread's `ThreadParticipant` table (the brief calls for
 * the offer chain to be visible only to the two real negotiation parties,
 * and the same buyer/seller pair owns every offer on the thread, so a
 * joined user would have been the seller/buyer on the originating thread).
 */
export function isOfferParty(offer: OfferLike, userId: string): boolean {
  return offer.buyerId === userId || offer.sellerId === userId;
}

/**
 * Variant of `isOfferParty` that RETURNS a NextResponse on a negative
 * verdict (default 404 — never an existence-leak), or null when the user
 * IS a party. Route handlers always short-circuit `null !== response` via
 *
 *   const blocked = assertOfferParty(offer, user.id);
 *   if (blocked) return blocked;
 *
 * (Why 404, not 403? The brief explicitly says "Confidentiality enforced
 * server-side, not hidden in UI" and the existing lot-visibility helper
 * also uses 404 for the same reason — a 403 confirms existence.)
 */
export function assertOfferParty(offer: OfferLike | null, userId: string): NextResponse | null {
  if (!offer) {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  }
  if (!isOfferParty(offer, userId)) {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  }
  return null;
}
