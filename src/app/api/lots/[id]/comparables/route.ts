// @polsia:user-owned — /api/lots/[id]/comparables endpoint. Returns up to six
// other lots matching the same polymer (and a similar grade / continent / size
// band) so the detail page can show a "similar listings" panel without extra
// round-trips.
//
// BOTH the source lot AND every returned comparable must pass the viewer's
// visibility gate — otherwise a MY_NETWORK row could be hinted by showing
// up next to a public comparable. Comparables the viewer can't see are DROPped
// from the response (not 404'd — this endpoint is a sidebar, not a resource).
import 'server-only';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { closeInScope, isWeaklyComparable } from '@/lib/business/comparable-matches';
import {
  ANONYMOUS_SCRUB,
  resolveViewerAccess,
  resolveVisibilityViewer,
} from '@/lib/business/lot-visibility';
import { type LotRow, lotRowToWire } from '@/lib/business/profiles';
import { LotItem, LotList } from '@/lib/contracts/lots';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const session = await auth.api.getSession({ headers: await headers() });
    const viewerUserId = session?.user?.id ?? null;
    const lot = await prisma.lot.findUnique({
      where: { id },
      select: {
        id: true,
        polymer: true,
        grade: true,
        quantityLb: true,
        country: true,
        location: true,
        visibility: true,
        postedByUserId: true,
        selectedCompanyIdentifiers: true,
      },
    });
    if (!lot) {
      return NextResponse.json({ error: 'Not Found' }, { status: 404 });
    }
    const viewer = await resolveVisibilityViewer(viewerUserId);
    // The source lot's row IS loaded. Pass the lot's stored
    // `selectedCompanyIdentifiers` (Json) into the gate so a viewer in
    // the SELECTED_COMPANIES list is correctly admitted — the result is
    // dropped on the wire if the viewer wasn't eligible to know the row
    // is in a particular polymer class. VIEWER-side locking: drop the
    // comparable set when the source lot itself isn't visible — keeps
    // the sidebar from leaking the existence of a private row.
    const gatedSource = resolveViewerAccess([lot], viewer);
    if (gatedSource.length === 0) {
      return NextResponse.json(LotList.parse({ items: [] }));
    }

    const sourceShape = {
      polymer: lot.polymer,
      grade: lot.grade,
      quantityLb: lot.quantityLb?.toString() ?? null,
      country: lot.country,
      location: lot.location,
    };

    // Pull a wider same-polymer candidate set then narrow in-process so we
    // can apply the `closeInScope` score (grade equivalence + band + continent
    // + region) without inventing new columns on `Lot`. Skip the Prisma-side
    // grade narrowing intentionally — `gradesEquivalent` accepts "5502S"
    // and "5502", and lots without a grade still need to surface.
    const candidateSet = await prisma.lot.findMany({
      where: {
        polymer: lot.polymer,
        id: { not: lot.id },
      },
      orderBy: { createdAt: 'desc' },
      take: 60,
    });

    const narrowed = candidateSet.filter((row) =>
      isWeaklyComparable(sourceShape, {
        polymer: row.polymer,
        grade: row.grade,
        quantityLb: row.quantityLb?.toString() ?? null,
        country: row.country,
        location: row.location,
      }),
    );

    // Same visibility gate on the candidate set — a PUBLIC comparable next
    // to a MY_NETWORK source row would otherwise reveal the private row's
    // polymer to non-network viewers simply by its absence.
    const visibleRows = resolveViewerAccess(narrowed, viewer);

    const scored = visibleRows
      .map((row) => ({
        row,
        score: closeInScope(sourceShape, {
          polymer: row.polymer,
          grade: row.grade,
          quantityLb: row.quantityLb?.toString() ?? null,
          country: row.country,
          location: row.location,
        }),
      }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const aTime = a.row.createdAt instanceof Date ? a.row.createdAt.getTime() : 0;
        const bTime = b.row.createdAt instanceof Date ? b.row.createdAt.getTime() : 0;
        return bTime - aTime;
      })
      .slice(0, 6)
      .map(({ row }) => row);

    const userIds = scored
      .map((r) => r.postedByUserId)
      .filter((uid): uid is string => Boolean(uid));
    const profiles = userIds.length
      ? await prisma.profile.findMany({
          where: { userId: { in: userIds } },
          select: { userId: true, handle: true, verificationStatus: true, role: true },
        })
      : [];
    const byUserId = new Map(profiles.map((p) => [p.userId, p]));

    const items = scored.map((row) => {
      const profile = row.postedByUserId ? byUserId.get(row.postedByUserId) : null;
      // ANONYMOUS comparables scrub the seller identity on the wire — same
      // pattern as GET on /api/lots and the detail handler. Batch import of
      // ANONYMOUS_SCRUB above means the wording stays in lock-step with the
      // rest of the API.
      const scrubbed =
        row.visibility === 'ANONYMOUS'
          ? { ...row, ...ANONYMOUS_SCRUB, profile: null }
          : { ...row, profile };
      return LotItem.parse(lotRowToWire(scrubbed as unknown as LotRow));
    });
    return NextResponse.json(LotList.parse({ items }));
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
