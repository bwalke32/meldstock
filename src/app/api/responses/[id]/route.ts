// @polsia:user-owned — /api/responses/[id] (single-row fetch on
// WANTED-side). Mirror of `/api/offers/[id]`: party-only, 404 on a
// missing row OR a non-party caller (existence hidden).
import 'server-only';
import { NextResponse } from 'next/server';
import { assertWantedResponseParty } from '@/lib/business/wanted-response-visibility';
import { createWantedResponseWireFromRow } from '@/lib/business/wanted-response-wire';
import { WantedResponseItem } from '@/lib/contracts/wanted-responses';
import { prisma } from '@/lib/db';
import { requireAuth, type SessionUser } from '@/lib/require-auth';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  let user: SessionUser;
  try {
    user = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  let responseId: string;
  try {
    const params = await ctx.params;
    responseId = params.id;
  } catch {
    return NextResponse.json({ error: 'Bad Request' }, { status: 400 });
  }

  try {
    const row = await prisma.wantedResponse.findUnique({
      where: { id: responseId },
    });
    if (!row) {
      return NextResponse.json({ error: 'Not Found' }, { status: 404 });
    }
    const gate = assertWantedResponseParty(row, user.id);
    if (gate) return gate;
    const wire = await createWantedResponseWireFromRow(row, user.id);
    return NextResponse.json(WantedResponseItem.parse(wire));
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
