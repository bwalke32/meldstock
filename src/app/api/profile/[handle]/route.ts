// @polsia:user-owned — /api/profile/[handle] — public-facing profile lookup.
// Public by design: any visitor with the URL can read it (a handle slug is
// effectively a public identifier). The visitor cannot mutate it — every
// mutating route is /api/profile (owner-scoped via requireAuth) or
// /api/profile/verification/*.
//
// Visibility hardening (G3): previously this handler returned ALL of
// the owner's lots unfiltered — a visitor could read any of the owner's
// MY_NETWORK or SELECTED_COMPANIES lot. We now resolve the viewer's
// gating context (auth session, profile, network) and apply the
// resolver to the owner's-lot list so non-permitted rows are dropped
// before the wire. The profile itself is still visible (its identity is
// intentionally public); only the lots it gates are filtered.
import 'server-only';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { resolveViewerAccess, resolveVisibilityViewer } from '@/lib/business/lot-visibility';
import { type ProfileRow, profileRowToWire, publicLotRowToWire } from '@/lib/business/profiles';
import { LotsByHandleResponse, ProfilePublic } from '@/lib/contracts/profiles';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

const PublicProfileResponse = z.object({
  profile: ProfilePublic,
  lots: LotsByHandleResponse,
});

export async function GET(_req: Request, ctx: { params: Promise<{ handle: string }> }) {
  try {
    const { handle } = await ctx.params;
    if (!handle || handle.length > 80) {
      return NextResponse.json({ error: 'Bad handle' }, { status: 400 });
    }
    const profile = await prisma.profile.findUnique({ where: { handle } });
    if (!profile) {
      return NextResponse.json({ error: 'Not Found' }, { status: 404 });
    }
    const ownerLotsRaw = await prisma.lot.findMany({
      where: { postedByUserId: profile.userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    // Resolve the viewer's gate once. Public listings + ANONYMOUS rows
    // pass through unchanged; MY_NETWORK only visible to the poster's
    // connections; SELECTED_COMPANIES only to listed identifiers.
    const session = await auth.api.getSession({ headers: await headers() });
    const viewer = await resolveVisibilityViewer(session?.user?.id ?? null);
    const visibleRows = resolveViewerAccess(ownerLotsRaw, viewer);
    return NextResponse.json(
      PublicProfileResponse.parse({
        profile: profileRowToWire(profile as ProfileRow),
        lots: { items: visibleRows.map(publicLotRowToWire) },
      }),
    );
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
