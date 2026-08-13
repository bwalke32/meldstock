// @polsia:user-owned — /api/lots/[id]/price-trend endpoint. Returns a 30-day
// daily-bucketed asking-price series for the same-polymer + grade-equivalent
// lot population, gated by the same viewer visibility rules as the detail
// and comparables handlers. Powers the sparkline strip rendered above the
// spec sheet on /lots/[id].
//
// Algorithm:
//   1. Load the source lot + auth session.
//   2. Apply the visibility gate (`lotBlockedResponse`) — non-entitled
//      viewers get a 404 BEFORE the strip loads, so the sparkline never
//      becomes a dangling widget for a private lot.
//   3. Fetch ALL same-polymer priced lots in the last 30 days (no row cap;
//      the comparables endpoint caps at 60, but the strip wants up to
//      30 days × N lots/day of density).
//   4. Filter in-process to grade-equivalent rows via the existing
//      `gradesEquivalent` helper. The source lot itself is included if
//      its `createdAt` falls in the window so its own data point sits on
//      the chart.
//   5. Re-apply the visibility gate to the candidate set so a MY_NETWORK
//      or SELECTED_COMPANIES row never leaks into a non-entitled
//      viewer's sparkline just because it shares a polymer.
//   6. Bucket by local YYYY-MM-DD, compute per-bucket min/median/max,
//      then a 30-day window-wide min/median/max for the label row.
import 'server-only';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { gradesEquivalent } from '@/lib/business/comparable-matches';
import {
  lotBlockedResponse,
  resolveViewerAccess,
  resolveVisibilityViewer,
} from '@/lib/business/lot-visibility';
import { PriceTrendResponse } from '@/lib/contracts/price-trend';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

const DAY_MS = 24 * 60 * 60 * 1000;

// One-line YYYY-MM-DD in the SERVER's local timezone — documented in the
// module header so the next reader doesn't try to introduce UTC drift.
function ymdLocal(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function decimalToNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  // Prisma Decimal: { toString(): string }
  const text = (v as { toString(): string }).toString();
  const n = Number.parseFloat(text);
  return Number.isFinite(n) ? n : null;
}

function medianOfSorted(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  if (n % 2 === 1) {
    return sorted[mid] ?? 0;
  }
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const session = await auth.api.getSession({ headers: await headers() });
    const viewerUserId = session?.user?.id ?? null;

    const source = await prisma.lot.findUnique({
      where: { id },
      select: {
        id: true,
        polymer: true,
        grade: true,
        visibility: true,
        postedByUserId: true,
        selectedCompanyIdentifiers: true,
        askingPricePerLb: true,
        createdAt: true,
      },
    });
    if (!source) {
      return NextResponse.json({ error: 'Not Found' }, { status: 404 });
    }
    const viewer = await resolveVisibilityViewer(viewerUserId);
    const blocked = lotBlockedResponse(source, viewer);
    if (blocked) return blocked;

    const nowMs = Date.now();
    const since = new Date(nowMs - 30 * DAY_MS);
    const candidates = await prisma.lot.findMany({
      where: {
        polymer: source.polymer,
        createdAt: { gte: since },
        askingPricePerLb: { not: null },
      },
      select: {
        id: true,
        grade: true,
        askingPricePerLb: true,
        createdAt: true,
        visibility: true,
        postedByUserId: true,
        selectedCompanyIdentifiers: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    // Decimal-typed columns map to Prisma.Decimal which doesn't always
    // accept a `gt: number` in `where` — filter for positive pricing in
    // process so the route is portable across Prisma versions.
    const pricedCandidates = candidates.filter((row) => {
      const num = decimalToNumber(row.askingPricePerLb);
      return num !== null && num > 0;
    });
    const narrowed = pricedCandidates.filter((row) =>
      gradesEquivalent(source.grade, row.grade ?? null),
    );
    const visibleRows = resolveViewerAccess(narrowed, viewer);

    const bucketsByYmd = new Map<string, number[]>();
    const allPrices: number[] = [];
    for (const row of visibleRows) {
      const num = decimalToNumber(row.askingPricePerLb);
      if (num === null || num <= 0) continue;
      const key = ymdLocal(row.createdAt);
      const arr = bucketsByYmd.get(key) ?? [];
      arr.push(num);
      bucketsByYmd.set(key, arr);
      allPrices.push(num);
    }

    const series = [...bucketsByYmd.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, prices]) => {
        const sorted = [...prices].sort((a, b) => a - b);
        const min = sorted.at(0) ?? 0;
        const max = sorted.at(-1) ?? 0;
        return { date, median: medianOfSorted(sorted), min, max, count: sorted.length };
      });

    const sortedAll = [...allPrices].sort((a, b) => a - b);
    const sampleCount = sortedAll.length;
    const minOverall = sortedAll.at(0) ?? 0;
    const maxOverall = sortedAll.at(-1) ?? 0;
    const medianOverall = medianOfSorted(sortedAll);

    const windowStartDate = new Date(since.getFullYear(), since.getMonth(), since.getDate());
    const today = new Date();

    return NextResponse.json(
      PriceTrendResponse.parse({
        series,
        windowStart: ymdLocal(windowStartDate),
        windowEnd: ymdLocal(today),
        stats: { min: minOverall, median: medianOverall, max: maxOverall, sampleCount },
        currentLotPrice:
          source.askingPricePerLb === null || source.askingPricePerLb === undefined
            ? null
            : (source.askingPricePerLb as { toString(): string }).toString(),
        polymer: source.polymer,
        grade: source.grade ?? null,
      }),
    );
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
