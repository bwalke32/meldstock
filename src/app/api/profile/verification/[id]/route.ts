// @polsia:user-owned — /api/profile/verification/[id] — admin decides PENDING
// requests as APPROVED or REJECTED. Gated to better-auth `role === 'admin'`.
// Mirrors the decision onto the linked Profile row + stamps `verifiedAt` on
// approval. Returns a 403 (not a redirect) per the AGENT.md note: a fetch
// should never be redirected.
import 'server-only';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import type { ZodError } from 'zod';
import { auth } from '@/lib/auth';
import {
  AdminVerificationDecision,
  type AdminVerificationDecisionInput,
  VerificationRequestItem,
} from '@/lib/contracts/profiles';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

function flattenZod(error: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [field, messages] of Object.entries(error.flatten().fieldErrors)) {
    const message = messages?.[0];
    if (message) out[field] = message;
  }
  return out;
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (session.user.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const { id } = await ctx.params;
    if (!id || id.length > 60) {
      return NextResponse.json({ error: 'Bad id' }, { status: 400 });
    }
    const parsed = AdminVerificationDecision.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ errors: flattenZod(parsed.error) }, { status: 400 });
    }
    const decision: AdminVerificationDecisionInput = parsed.data;
    const existing = await prisma.verificationRequest.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (existing.status !== 'PENDING') {
      return NextResponse.json({ error: `Already decided: ${existing.status}` }, { status: 409 });
    }
    const newStatus = decision.decision === 'APPROVED' ? 'VERIFIED' : 'REJECTED';
    const updated = await prisma.verificationRequest.update({
      where: { id },
      data: {
        status: newStatus,
        decidedAt: new Date(),
        reviewerNote: decision.reviewerNote ?? null,
        reviewedByUserId: session.user.id,
      },
    });
    // Mirror onto Profile row + stamp verifiedAt on approval.
    await prisma.profile.update({
      where: { id: existing.profileId },
      data: {
        verificationStatus: newStatus,
        verifiedAt: decision.decision === 'APPROVED' ? new Date() : null,
      },
    });
    return NextResponse.json({
      request: VerificationRequestItem.parse({
        id: updated.id,
        profileId: updated.profileId,
        status: updated.status,
        requestedAt: updated.requestedAt.toISOString(),
        decidedAt: updated.decidedAt?.toISOString() ?? null,
        requestedDocumentsText: updated.requestedDocumentsText,
        reviewerNote: updated.reviewerNote,
        reviewedByUserId: updated.reviewedByUserId,
      }),
    });
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
