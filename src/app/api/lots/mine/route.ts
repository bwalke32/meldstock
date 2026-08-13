// @polsia:user-owned — GET /api/lots/mine.
//
// Owner-scoped list of every lot the viewer has posted, in every status.
// Powers the /dashboard/inventory table — the broker needs to see their
// own SOLD / EXPIRED / DEACTIVATED rows so the table can render the
// matching badge. Public GET /api/lots hides non-ACTIVE rows from
// non-owners (see route.ts lifecycleWhere) but a buyer wouldn't see
// non-ACTIVE anyway, so this endpoint is the per-owner counterpart.
//
// Distinct sibling endpoint from `/api/lots/[id]/route.ts` (single-lot
// detail) so a `take`+orderBy read doesn't double as a "list mine" route
// with an extra ownership gate. The wire shape is the same `LotItem` so
// the table's parser doesn't need a second contract.
import 'server-only';
import { NextResponse } from 'next/server';
import { resolveViewerAccess, resolveVisibilityViewer } from '@/lib/business/lot-visibility';
import { type LotRow, lotRowToWire } from '@/lib/business/profiles';
import { LotItem, LotList } from '@/lib/contracts/lots';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/require-auth';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request) {
  let userId: string;
  try {
    userId = (await requireAuth()).id;
  } catch (res) {
    return res as Response;
  }

  const rows = await prisma.lot.findMany({
    where: { postedByUserId: userId },
    orderBy: { lastUpdatedAt: 'desc' },
    take: 200,
  });

  // Apply the same visibility gate as the public GET so rows the viewer
  // shouldn't see (e.g. ANONYMOUS listings they themselves wrote with a
  // different visibility tier, in case the resolver gates against their
  // own posts) collapse out before they reach the wire. The viewer IS
  // the poster, so the gate short-circuits to true for every row — kept
  // for symmetry with the public list handler.
  const viewer = await resolveVisibilityViewer(userId);
  const visibleRows = resolveViewerAccess(rows, viewer);

  const profiles = await prisma.profile.findMany({
    where: { userId: { in: [userId] } },
    select: { userId: true, handle: true, verificationStatus: true, role: true },
  });
  const profile = profiles[0] ?? null;

  const items = visibleRows.map((row) => {
    const merged = { ...row, profile };
    return LotItem.parse(lotRowToWire(merged as unknown as LotRow));
  });
  return NextResponse.json(LotList.parse({ items }), { status: 200 });
}
