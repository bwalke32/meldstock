// @polsia:user-owned — /api/rooms/invitees endpoint.
//
// GET: the pool of users the caller can invite into a broker-group room,
// combined from TWO sources:
//
//   - NETWORK: every other half of an accepted `Connection` pair the
//     caller is on. Bidirectional — `Connection` rows have a canonical
//     `userIdA < userIdB` invariant, so the `Connection.findMany({ OR:
//     [{ userIdA: me }, { userIdB: me }] })` query matches both halves.
//
//   - VERIFIED_COMPANY: every `Profile` with
//     `verificationStatus === 'VERIFIED'`, regardless of whether they're
//     in the caller's network — so a broker can pull in a counterparty
//     they've never met but who has cleared verification.
//
// Two sources means a single user can appear in both pools; the wire
// returns flat `InviteeItem` rows tagged with `source` so the picker can
// show "@handle · from your network" / "@handle · verified company"
// labels, and dedupe on render.
import 'server-only';
import { NextResponse } from 'next/server';
import { type InviteeItem, InviteeList } from '@/lib/contracts/messaging';
import { prisma } from '@/lib/db';
import { requireAuth, type SessionUser } from '@/lib/require-auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  let user: SessionUser;
  try {
    user = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  try {
    const [connections, verified] = await Promise.all([
      prisma.connection.findMany({
        where: { status: 'ACCEPTED', OR: [{ userIdA: user.id }, { userIdB: user.id }] },
        select: { userIdA: true, userIdB: true },
      }),
      prisma.profile.findMany({
        where: { verificationStatus: 'VERIFIED' },
        select: { userId: true },
      }),
    ]);

    const networkIds = new Set<string>();
    for (const row of connections) {
      const other = row.userIdA === user.id ? row.userIdB : row.userIdA;
      if (other !== user.id) networkIds.add(other);
    }
    const verifiedIds = new Set<string>();
    for (const p of verified) {
      if (p.userId !== user.id) verifiedIds.add(p.userId);
    }

    // Batched profile load — same query covers both pools. The wire
    // duplicates the result for users present in both pools with a
    // distinct `source` field per entry; the picker dedupes visually.
    const allIds = Array.from(new Set([...networkIds, ...verifiedIds]));
    if (allIds.length === 0) {
      return NextResponse.json(InviteeList.parse({ items: [], networkCount: 0, verifiedCount: 0 }));
    }
    const profiles = await prisma.profile.findMany({
      where: { userId: { in: allIds } },
      select: { userId: true, displayName: true, companyName: true, handle: true },
    });
    const profileByUser = new Map(profiles.map((p) => [p.userId, p]));

    const items: InviteeItem[] = [];
    for (const id of networkIds) {
      const p = profileByUser.get(id);
      items.push({
        userId: id,
        displayName: p?.displayName ?? 'User',
        companyName: p?.companyName ?? null,
        handle: p?.handle ?? null,
        source: 'NETWORK',
      });
    }
    for (const id of verifiedIds) {
      const p = profileByUser.get(id);
      items.push({
        userId: id,
        displayName: p?.displayName ?? 'User',
        companyName: p?.companyName ?? null,
        handle: p?.handle ?? null,
        source: 'VERIFIED_COMPANY',
      });
    }

    return NextResponse.json(
      InviteeList.parse({
        items,
        networkCount: networkIds.size,
        verifiedCount: verifiedIds.size,
      }),
    );
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
