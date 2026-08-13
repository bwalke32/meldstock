// @polsia:user-owned — saved-search delete (per id). Gated by requireAuth()
// and scoped `where: { id, userId: user.id }` so a caller can't delete
// another user's saved search by guessing its id.

import 'server-only';
import { NextResponse } from 'next/server';
import { lotMatchesSavedSearch } from '@/lib/business/lot-filters';
import { LotFilter, type LotFilter as LotFilterType } from '@/lib/contracts/lots-filters';
import { parseSavedSearchFilter, SavedSearchUpdate } from '@/lib/contracts/saved-searches';
import { prisma } from '@/lib/db';
import { requireAuth, type SessionUser } from '@/lib/require-auth';

export const dynamic = 'force-dynamic';

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  let user: SessionUser;
  try {
    user = await requireAuth(req);
  } catch (res) {
    return res as Response;
  }

  try {
    const { id } = await ctx.params;
    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }
    // Composite `id` + `userId` scope deletes in one shot and reports 404
    // when the row belongs to a different user (security: don't leak 404 vs
    // 403 distinction — but the id is a cuid so guessing is impractical).
    const result = await prisma.savedSearch.deleteMany({
      where: { id, userId: user.id },
    });
    if (result.count === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// In-place edit: name / filter / alertEnabled — all optional so a single
// PATCH can flip the toggle, rename, or rewrite the filter independently.
// Returns the full updated row (so the client's optimistic state replaces
// with a truth source) — the same shape as GET /api/saved-searches#GET so
// the response round-trips through SavedSearch.parse(...) without drift.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  let user: SessionUser;
  try {
    user = await requireAuth(req);
  } catch (res) {
    return res as Response;
  }

  try {
    const { id } = await ctx.params;
    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }
    const parsed = SavedSearchUpdate.safeParse(await req.json());
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const [field, messages] of Object.entries(parsed.error.flatten().fieldErrors)) {
        const message = messages?.[0];
        if (message) errors[field] = message;
      }
      return NextResponse.json({ errors }, { status: 400 });
    }
    const update = parsed.data;
    // Validate the new filter against the live contract even when only a
    // subset of fields is supplied — unknown keys get stripped at parse time
    // so the row never carries stale fields.
    const nextFilter: LotFilterType | undefined =
      update.filter !== undefined ? LotFilter.parse(update.filter) : undefined;

    const existing = await prisma.savedSearch.findFirst({
      where: { id, userId: user.id },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const data: Record<string, unknown> = {};
    if (update.name !== undefined) data.name = update.name;
    if (nextFilter !== undefined) data.filterJson = nextFilter;
    if (update.alertEnabled !== undefined) data.alertEnabled = update.alertEnabled;

    const updated = await prisma.savedSearch.update({
      where: { id: existing.id },
      data,
    });

    const filter = nextFilter ?? parseSavedSearchFilter(updated.filterJson);
    // Live matchCount is recomputed on every PATCH; cheap (capped candidate
    // set), and the client island renders the same number once the response
    // lands on top of the optimistic update.
    const matchCount = await computeMatchCount(filter);

    return NextResponse.json({
      id: updated.id,
      name: updated.name,
      filter,
      matchCount,
      alertEnabled: updated.alertEnabled,
      lastAlertSentAt: updated.lastAlertSentAt?.toISOString() ?? null,
      createdAt: updated.createdAt.toISOString(),
    });
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// Live match count — same shape as /api/saved-searches/route.ts#GET: cap
// the candidate set and intersect with the client-only matcher so an
// in-place edit reflects the same "live matches" the page promises. The
// `where` clause above in .ts clones the GET handler's keys (type, polymer,
// condition, form, grade, color, q, hasCoa) — duplicate rather than share so
// the [id] route stays self-contained.
const MATCH_COUNT_CANDIDATES = 200;
async function computeMatchCount(filter: LotFilterType): Promise<number> {
  try {
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
    const candidates = await prisma.lot.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: MATCH_COUNT_CANDIDATES,
    });
    return candidates.filter((lot) => lotMatchesSavedSearch(lot, filter)).length;
  } catch {
    return 0;
  }
}
