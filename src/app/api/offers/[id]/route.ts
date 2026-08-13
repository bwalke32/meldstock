// @polsia:user-owned — /api/offers/[id] — single-offer GET endpoint.
//
// Requires the caller to be a party on the row (buyer or seller id).
// Existence is hidden on a 404 — matches `/api/listings/[id]/offers`
// confidentiality posture (a third-party signed-in user gets 404, not 403).
import 'server-only';
import { NextResponse } from 'next/server';
import { assertOfferParty } from '@/lib/business/offer-visibility';
import { createOfferWireFromRow } from '@/lib/business/offer-wire';
import { OfferItem } from '@/lib/contracts/offers';
import { prisma } from '@/lib/db';
import { requireAuth, type SessionUser } from '@/lib/require-auth';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  let user: SessionUser;
  try {
    user = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  let offerId: string;
  try {
    const params = await ctx.params;
    offerId = params.id;
  } catch {
    return NextResponse.json({ error: 'Bad Request' }, { status: 400 });
  }

  try {
    const row = await prisma.offer.findUnique({ where: { id: offerId } });
    const gate = assertOfferParty(row, user.id);
    if (gate) return gate;
    if (!row) return NextResponse.json({ error: 'Not Found' }, { status: 404 });
    const wire = await createOfferWireFromRow(row, user.id);
    return NextResponse.json(OfferItem.parse(wire));
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
