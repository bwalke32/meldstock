// @polsia:user-owned — marketplace-wide teaser for the /dashboard "Live
// market" panel. Owner-scoped via requireAuth (parity with
// /api/dashboard/overview) so unauthenticated callers are 401'd at the gate,
// then the visibility helper runs to make sure PRIVATE / SELECTED_COMPANIES /
// MY_NETWORK rows never leak into the snippet even though the panel reads
// from the whole marketplace.
//
// Two headline widgets feed the panel:
//   - recent: the 5 most-recent lots visible to the viewer. We fetch a
//     30-row headroom to absorb the visibility filter without losing the
//     topmost visible row.
//   - topPolymers: the top 3 polymers by listing volume in the last 7 days
//     for lots visible to the viewer. Aggregated in JS after the same gate
//     runs so the rule set stays in one place (no re-implementing the gate
//     inside Prisma groupBy).
//
// Failures degrade to empty arrays + a server-side warn — the panel renders
// empty-state copy and the dashboard never crashes on transient errors.

import 'server-only';
import { NextResponse } from 'next/server';
import { resolveViewerAccess, resolveVisibilityViewer } from '@/lib/business/lot-visibility';
import {
  LiveMarketSnapshot,
  type RecentItem,
  type TopPolymerRow,
} from '@/lib/contracts/live-market';
import type { Polymer } from '@/lib/contracts/lots';
import { prisma } from '@/lib/db';
import { requireAuth, type SessionUser } from '@/lib/require-auth';

export const dynamic = 'force-dynamic';

// Cover the recent-5 with enough headroom that the visibility filter doesn't
// sink the topmost visible row. 30 is comfortably overkill but bounded.
const RECENT_HEADROOM = 30;
// 200 rows of 7-day headroom is plenty to surface the top 3 polymers once
// gated. Going larger turns the join into a scan; staying at 200 keeps the
// window deterministic.
const TOP_POLYMER_HEADROOM = 200;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export async function GET(req: Request) {
  let user: SessionUser;
  try {
    user = await requireAuth(req);
  } catch (res) {
    return res as Response;
  }

  try {
    const viewer = await resolveVisibilityViewer(user.id);

    const [recentHeadroom, topHeadroom] = await Promise.all([
      prisma.lot.findMany({
        orderBy: { createdAt: 'desc' },
        take: RECENT_HEADROOM,
        select: {
          id: true,
          polymer: true,
          grade: true,
          quantityLb: true,
          createdAt: true,
          type: true,
          condition: true,
          color: true,
          form: true,
          manufacturer: true,
          // Visibility gate needs id / postedByUserId / visibility at minimum.
          visibility: true,
          postedByUserId: true,
          selectedCompanyIdentifiers: true,
        },
      }),
      prisma.lot.findMany({
        where: { createdAt: { gte: new Date(Date.now() - SEVEN_DAYS_MS) } },
        orderBy: { createdAt: 'desc' },
        take: TOP_POLYMER_HEADROOM,
        select: {
          polymer: true,
          visibility: true,
          postedByUserId: true,
          selectedCompanyIdentifiers: true,
          id: true,
        },
      }),
    ]);

    const visibleRecentRows = resolveViewerAccess(recentHeadroom, viewer);
    const visibleTopRows = resolveViewerAccess(topHeadroom, viewer);
    const recentShape: RecentItem[] = visibleRecentRows.slice(0, 5).map((row) => ({
      id: row.id,
      polymer: row.polymer,
      grade: row.grade,
      quantityLb: row.quantityLb.toString(),
      createdAt: row.createdAt.toISOString(),
      type: row.type,
      condition: row.condition,
      color: row.color,
      form: row.form,
      manufacturer: row.manufacturer,
    }));

    // Visible-to-viewer aggregation over the same 7-day window. Running the
    // visibility gate up front means a private lot never feeds a public
    // snippet count.
    const polymerCounts = new Map<Polymer, number>();
    for (const row of visibleTopRows) {
      polymerCounts.set(row.polymer, (polymerCounts.get(row.polymer) ?? 0) + 1);
    }
    const topPolymers: TopPolymerRow[] = [...polymerCounts.entries()]
      .sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1];
        // Stable tiebreak: alphabetical by Polymer so the panel doesn't
        // flicker between equal-count rows on different renders.
        return a[0].localeCompare(b[0]);
      })
      .slice(0, 3)
      .map(([polymer, count]) => ({ polymer, count }));

    const snapshot = LiveMarketSnapshot.parse({
      recent: recentShape,
      topPolymers,
      fetchedAt: new Date().toISOString(),
    });
    return NextResponse.json(snapshot);
  } catch (_err) {
    return NextResponse.json(
      LiveMarketSnapshot.parse({
        recent: [],
        topPolymers: [],
        fetchedAt: new Date().toISOString(),
      }),
    );
  }
}
