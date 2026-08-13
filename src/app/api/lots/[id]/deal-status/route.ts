// @polsia:user-owned — /api/lots/[id]/deal-status endpoint.
//
// Resolves the *caller's own* most-recent active thread with this lot's
// seller and returns its stepper state. Surfaced so the lot detail
// client island can render the strip above the spec sheet without
// needing to inline the matrix into the existing GET handler.
//
// Permission: must be signed-in (any role). Returns 404 if the lot is
// not visible to the viewer (matches the detail GET's binary hide via
// `lotBlockedResponse` — even existence is not hinted). ANONYMOUS lots
// short-circuit to `null` — anonymous listings have no persisted
// counter-party state to surface.
//
// Query: ONE `MessageThread` where `lotId === lot.id` AND caller is a
// `ThreadParticipant` row. Status PENDING here is only used to exclude
// already-closed-out threads (COMPLETED / CANCELED); the new stepper
// is allowed to live on a closed-out thread if the seller kept moving
// it. Order by `lastMessageAt DESC` take 1 so the most recent thread
// wins (a buyer can open multiple threads with the same seller over
// the lifetime of a listing — the most recent is the "current deal").
import 'server-only';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { lotBlockedResponse, resolveVisibilityViewer } from '@/lib/business/lot-visibility';
import { ensureParticipantRoster } from '@/lib/business/thread-participants';
import {
  DEAL_STATUS_ORDER,
  type DealStatus,
  DealStatusEnum,
  DealStatusState,
  LotDealStatusResponse,
} from '@/lib/contracts/messaging';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/require-auth';

export const dynamic = 'force-dynamic';

const orderedStepsForWire: DealStatus[] = [...DEAL_STATUS_ORDER];

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;

    const [session, lot] = await Promise.all([
      auth.api.getSession({ headers: await headers() }),
      prisma.lot.findUnique({ where: { id } }),
    ]);
    if (!lot) {
      return NextResponse.json({ error: 'Not Found' }, { status: 404 });
    }
    const viewer = await resolveVisibilityViewer(session?.user?.id ?? null);
    const blocked = lotBlockedResponse(lot, viewer);
    if (blocked) return blocked;

    // Anonymous listings — no persisted counter-party state to surface.
    // The detail GET scrambles `postedByUserId/Name/Handle` to the
    // `ANONYMOUS_SCRUB` constants; mirroring the same decision here so
    // a viewer can't probe who has been dealing on an anonymous lot.
    const isAnonymous = lot.visibility === 'ANONYMOUS';
    if (isAnonymous) {
      return NextResponse.json(LotDealStatusResponse.parse({ dealStatusBlock: null }));
    }
    // Anonymous viewer — no caller to attribute a deal to. Hide the
    // strip rather than return the most-recent thread.
    const callerId = await getSessionUser().then((u) => u?.id ?? null);
    if (callerId === null) {
      return NextResponse.json(LotDealStatusResponse.parse({ dealStatusBlock: null }));
    }

    // Resolve the caller's most recent thread with this lot's seller.
    // Filter to PENDING on the existing closeout lifetime so completed /
    // canceled threads don't take priority — the brief expects the live
    // open thread to be the "current deal". `kind` defaults to LISTING
    // for legacy rows so the filter stays correct. The thread's
    // `sellerId` was stamped to `lot.postedByUserId` at creation; we
    // don't filter on it explicitly (already implied by `lotId === id`)
    // and we don't want to exclude legacy threads whose sellerId may
    // be missing if `postedByUserId` was null on the lot at create time.
    const candidate = await prisma.messageThread.findFirst({
      where: {
        lotId: id,
        status: 'PENDING',
        kind: { in: ['LISTING', 'RFQ'] },
        participants: { some: { userId: callerId } },
      },
      orderBy: { lastMessageAt: 'desc' },
      select: {
        id: true,
        // The four columns `ensureParticipantRoster` reads to compute
        // its backfill (id + buyerId + sellerId + createdAt) are
        // selected here so the helper accepts the row without a
        // second round-trip. `dealStatus*` are the wire payload; the
        // rest is structural metadata.
        sellerId: true,
        buyerId: true,
        createdAt: true,
        kind: true,
        dealStatus: true,
        dealStatusUpdatedAt: true,
      },
    });
    if (!candidate) {
      return NextResponse.json(LotDealStatusResponse.parse({ dealStatusBlock: null }));
    }
    // Belt-and-braces: backfill the seller/buyer participant rows in
    // case this thread pre-dates the migration. Same helper the detail
    // GET uses, so behaviour stays consistent.
    await ensureParticipantRoster(candidate);

    const isSeller = candidate.sellerId !== null && candidate.sellerId === callerId;
    const isAdmin = session?.user?.role === 'admin';
    const canAdvance = isSeller || isAdmin;

    const block = DealStatusState.parse({
      threadId: candidate.id,
      dealStatus: DealStatusEnum.parse(candidate.dealStatus),
      dealStatusUpdatedAt: candidate.dealStatusUpdatedAt?.toISOString() ?? null,
      canAdvance,
      orderedSteps: orderedStepsForWire,
    });

    return NextResponse.json(LotDealStatusResponse.parse({ dealStatusBlock: block }));
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
