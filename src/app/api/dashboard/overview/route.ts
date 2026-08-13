// @polsia:user-owned — dashboard overview endpoint. Owner-scoped (requireAuth)
// so every query is gated to the signed-in caller. Returns three counts (plus
// a flag for whether the open-RFQ count is filtered by buyer interest) + the
// most recent 6 lots owned by the caller for the inventory rail.
//
// RFQ-matching uses the caller's profile.materialsBought as the polymer filter;
// if the profile is missing or materialsBought is empty, the RFQ count falls
// back to every open WANTED and `interestMatched` is false. Profile read is
// best-effort — a stale or missing profile must never break the dashboard.

import 'server-only';
import { NextResponse } from 'next/server';
import { asStringArray, type LotRow, lotRowToWire } from '@/lib/business/profiles';
import { DashboardOverview } from '@/lib/contracts/dashboard';
import { LotItem } from '@/lib/contracts/lots';
import { prisma } from '@/lib/db';
import { requireAuth, type SessionUser } from '@/lib/require-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  let user: SessionUser;
  try {
    user = await requireAuth(req);
  } catch (res) {
    return res as Response;
  }

  try {
    const { buyerMaterials, postedByHandle, postedByRole } = await loadProfileContext(user.id);
    const interestMatched = buyerMaterials.length > 0;

    const rfqWhere: Record<string, unknown> = { type: 'WANTED' };
    if (interestMatched) {
      rfqWhere.polymer = { in: buyerMaterials };
    }

    const [myHave, myWanted, recent, openRfqCount] = await Promise.all([
      prisma.lot.count({ where: { postedByUserId: user.id, type: 'HAVE' } }),
      prisma.lot.count({ where: { postedByUserId: user.id, type: 'WANTED' } }),
      prisma.lot.findMany({
        where: { postedByUserId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 6,
      }),
      prisma.lot.count({ where: rfqWhere }),
    ]);

    const items = recent.map((row) =>
      LotItem.parse(
        lotRowToWire({
          ...row,
          profile: postedByHandle ? { handle: postedByHandle, role: postedByRole } : null,
        } as unknown as LotRow),
      ),
    );

    return NextResponse.json(
      DashboardOverview.parse({
        metrics: { myHave, myWanted, openRfqCount, interestMatched },
        recent: items,
      }),
    );
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

async function loadProfileContext(userId: string): Promise<{
  buyerMaterials: string[];
  postedByHandle: string | null;
  postedByRole: string | null;
}> {
  try {
    const profile = await prisma.profile.findUnique({
      where: { userId },
      select: { handle: true, materialsBought: true, role: true },
    });
    return {
      buyerMaterials: asStringArray(profile?.materialsBought) ?? [],
      postedByHandle: profile?.handle ?? null,
      postedByRole: profile?.role ?? null,
    };
  } catch {
    return { buyerMaterials: [], postedByHandle: null, postedByRole: null };
  }
}
