// @polsia:user-owned — WantedResponse visibility gate. Mirror of
// `offer-visibility.ts`. Reused by every route under
// /api/listings/[id]/responses/* and /api/responses/[id]/* so access
// is answered identically across the resource. Existence is hidden on
// a 404 / 403 — never an existence-leak via 200 with an empty list.
//
// Server-only — imports `NextResponse`; only API handlers touch it.
import 'server-only';
import { NextResponse } from 'next/server';

export type WantedResponseLike = {
  id: string;
  lotId: string;
  threadId: string;
  // buyerId = RFQ poster (lot.postedByUserId) — see file banner in
  // prisma/schema/wanted-responses.prisma.
  buyerId: string;
  // sellerId = respondent (the party who submitted the structured block).
  sellerId: string;
};

/**
 * Predicate: is `userId` the buyer (RFQ poster) or the seller
 * (respondent) on this response row? Returned counts are purely
 * "on this row" — does NOT consult the thread's `ThreadParticipant`
 * table. The brief calls for the response chain to be visible only to
 * the two real negotiation parties, and the same buyer/seller pair
 * owns every response on the thread, so a joined user would have been
 * the seller/buyer on the originating thread.
 */
export function isWantedResponseParty(response: WantedResponseLike, userId: string): boolean {
  return response.buyerId === userId || response.sellerId === userId;
}

/**
 * Variant of `isWantedResponseParty` that RETURNS a NextResponse on a
 * negative verdict (default 404 — never an existence-leak), or null
 * when the user IS a party. Route handlers always short-circuit
 * `null !== response` via
 *
 *   const blocked = assertWantedResponseParty(response, user.id);
 *   if (blocked) return blocked;
 *
 * (Why 404, not 403? Mirrors the brief's "Confidentiality enforced
 * server-side, not hidden in UI" — a 403 confirms existence.)
 */
export function assertWantedResponseParty(
  response: WantedResponseLike | null,
  userId: string,
): NextResponse | null {
  if (!response) {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  }
  if (!isWantedResponseParty(response, userId)) {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  }
  return null;
}
