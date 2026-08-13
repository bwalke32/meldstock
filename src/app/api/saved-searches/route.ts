// @polsia:user-owned — saved-searches CRUD. All routes gated by requireAuth()
// and scoped `where: { userId: user.id }` so cross-user reads are impossible.
//
// GET: returns the caller's saved searches. Each row carries a live
// `matchCount` computed by re-applying the stored filter against the same
// Prisma `where` clause /api/lots#GET uses, then intersecting with the
// client-only keys via `lotMatchesSavedSearch` so the count matches the
// in-browser intersection. Bad rows degrade to 0; the rest still render.
//
// POST: persist a new SavedSearch for the caller. The wire shape is
// `{ name, filter }`; id/matchCount/createdAt are server-derived.

import 'server-only';
import { NextResponse } from 'next/server';
import { lotMatchesSavedSearch } from '@/lib/business/lot-filters';
import { LotFilter, type LotFilter as LotFilterType } from '@/lib/contracts/lots-filters';
import {
  parseSavedSearchFilter,
  SavedSearchCreate,
  SavedSearchList,
} from '@/lib/contracts/saved-searches';
import { prisma } from '@/lib/db';
import { requireAuth, type SessionUser } from '@/lib/require-auth';

export const dynamic = 'force-dynamic';

// Bounds the candidate set so a popular filter doesn't become a `count(*)`
// against the entire history — same shape as a normal /api/lots browse.
const MATCH_COUNT_CANDIDATES = 200;

function buildPrismaWhere(filter: LotFilterType): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  if (filter.type !== 'ALL') where.type = filter.type;
  if (filter.polymers.length > 0) where.polymer = { in: filter.polymers };
  if (filter.conditions.length > 0) where.condition = { in: filter.conditions };
  if (filter.form) where.form = { equals: filter.form, mode: 'insensitive' };
  if (filter.grade) where.grade = { contains: filter.grade, mode: 'insensitive' };
  if (filter.color) where.color = { contains: filter.color, mode: 'insensitive' };
  if (filter.q) {
    where.OR = [
      { notes: { contains: filter.q, mode: 'insensitive' } },
      { manufacturer: { contains: filter.q, mode: 'insensitive' } },
      { grade: { contains: filter.q, mode: 'insensitive' } },
      { color: { contains: filter.q, mode: 'insensitive' } },
    ];
  }
  if (filter.hasCoa !== null) where.hasCoa = filter.hasCoa;
  if (filter.quantityMin !== null || filter.quantityMax !== null) {
    const quantityRange: Record<string, number> = {};
    if (filter.quantityMin !== null) quantityRange.gte = filter.quantityMin;
    if (filter.quantityMax !== null) quantityRange.lte = filter.quantityMax;
    where.quantityLb = quantityRange;
  }
  if (filter.location) where.location = { contains: filter.location, mode: 'insensitive' };
  return where;
}

async function computeMatchCount(filter: LotFilterType): Promise<number> {
  try {
    const candidates = await prisma.lot.findMany({
      where: buildPrismaWhere(filter),
      orderBy: { createdAt: 'desc' },
      take: MATCH_COUNT_CANDIDATES,
    });
    return candidates.filter((lot) => lotMatchesSavedSearch(lot, filter)).length;
  } catch {
    return 0;
  }
}

export async function GET(_req: Request) {
  let user: SessionUser;
  try {
    user = await requireAuth(_req);
  } catch (res) {
    return res as Response;
  }

  try {
    const rows = await prisma.savedSearch.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });
    const counts = await Promise.all(
      rows.map((row) => computeMatchCount(parseSavedSearchFilter(row.filterJson))),
    );
    const items = rows.map((row, idx) => {
      const filter = parseSavedSearchFilter(row.filterJson);
      return {
        id: row.id,
        name: row.name,
        filter,
        matchCount: counts[idx] ?? 0,
        alertEnabled: row.alertEnabled,
        lastAlertSentAt: row.lastAlertSentAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      };
    });
    return NextResponse.json(SavedSearchList.parse({ items }));
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let user: SessionUser;
  try {
    user = await requireAuth(req);
  } catch (res) {
    return res as Response;
  }

  try {
    const parsed = SavedSearchCreate.safeParse(await req.json());
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const [field, messages] of Object.entries(parsed.error.flatten().fieldErrors)) {
        const message = messages?.[0];
        if (message) errors[field] = message;
      }
      return NextResponse.json({ errors }, { status: 400 });
    }
    // Normalise filter through LotFilter.parse(…) so the stored JSON is the
    // current contract's shape — no stale fields, no surprises.
    const filter = LotFilter.parse(parsed.data.filter);
    const created = await prisma.savedSearch.create({
      data: {
        userId: user.id,
        name: parsed.data.name,
        filterJson: filter,
      },
    });
    const matchCount = await computeMatchCount(filter);
    return NextResponse.json(
      {
        id: created.id,
        name: created.name,
        filter,
        matchCount,
        alertEnabled: created.alertEnabled,
        lastAlertSentAt: created.lastAlertSentAt?.toISOString() ?? null,
        createdAt: created.createdAt.toISOString(),
      },
      { status: 201 },
    );
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
