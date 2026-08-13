// @polsia:user-owned — POST /api/lots/bulk-lifecycle.
//
// Owner-only. Fans one lifecycle action across multiple lot ids in a single
// transaction, so a partial failure can't half-apply (a bulk "deactivate"
// that succeeds for 5 of 6 rows leaves the 6th row ACTIVE — not 3 active
// and 3 deactivated). Returns `{ updated, skipped: [{ id, reason }] }`
// where `skipped` covers ONLY ids the caller passed that didn't match
// (not present OR not owned by caller); parse/input errors 400 before any
// update runs.
//
// Note: this is a SIBLING of /api/lots/bulk (CSV upload) — distinct paths,
// distinct contracts. The existing /api/lots/bulk route handler is left
// untouched per the brief so the CSV flow doesn't drift.
import 'server-only';
import { NextResponse } from 'next/server';
import { touchLotBump } from '@/lib/business/lot-lifecycle';
import {
  type BulkLotsAction,
  BulkLotsActionBody,
  BulkLotsActionResponse,
} from '@/lib/contracts/lots-lifecycle';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/require-auth';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let userId: string;
  let userRole: string | undefined;
  try {
    const user = await requireAuth();
    userId = user.id;
    userRole = (user as { role?: string }).role;
  } catch (res) {
    return res as Response;
  }
  const isAdmin = userRole === 'admin';

  const parsed = BulkLotsActionBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const [field, messages] of Object.entries(parsed.error.flatten().fieldErrors)) {
      const message = messages?.[0];
      if (message) errors[field] = message;
    }
    return NextResponse.json({ errors }, { status: 400 });
  }

  const { ids, action } = parsed.data;
  // Load the candidate rows once so we know which ids are owned by the
  // caller. Filter at the DB layer (`postedByUserId = userId OR admin`);
  // other rows go into `skipped` with `not_owned_or_missing`.
  const candidates = await prisma.lot.findMany({
    where: {
      id: { in: ids },
      ...(isAdmin ? {} : { postedByUserId: userId }),
    },
    select: { id: true, postedByUserId: true, status: true },
  });
  const ownedIds = new Set(candidates.map((c) => c.id));
  const skipped: Array<{ id: string; reason: string }> = [];
  for (const id of ids) {
    if (!ownedIds.has(id)) skipped.push({ id, reason: 'not_owned_or_missing' });
  }

  const targets = candidates.filter((c) => ownedIds.has(c.id));
  let updated = 0;
  if (targets.length > 0) {
    try {
      await prisma.$transaction(targets.map((c) => buildUpdate(c.id, action)));
      updated = targets.length;
    } catch {
      return NextResponse.json(
        { error: 'Bulk update failed; no rows were changed' },
        { status: 500 },
      );
    }
  }

  const response = BulkLotsActionResponse.parse({ updated, skipped });
  return NextResponse.json(response, { status: 200 });
}

function buildUpdate(lotId: string, action: BulkLotsAction): ReturnType<typeof prisma.lot.update> {
  const base = touchLotBump();
  // Zod narrows `action` to one of the three below; the union is closed
  // and typed, so the switch is exhaustive at the type layer. Any future
  // action added at the contract layer that we forget to handle here will
  // show up as a compile error.
  switch (action) {
    case 'refresh':
      return prisma.lot.update({
        where: { id: lotId },
        data: { ...base, lastNudgedAt: null },
      });
    case 'deactivate':
      return prisma.lot.update({
        where: { id: lotId },
        data: { ...base, status: 'DEACTIVATED' },
      });
    case 'markSold':
      return prisma.lot.update({
        where: { id: lotId },
        data: { ...base, status: 'SOLD', quantityRemaining: 0, lastConfirmedAt: new Date() },
      });
  }
}
