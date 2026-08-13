// @polsia:user-owned — /api/profile/verification — submit a verification request.
// POST requires auth + the caller must own a Profile (else 404 — no profile
// means no verification). The route is idempotent: if there is already an
// open PENDING request for this profile, return 409 instead of creating a
// duplicate. Owner-scoped via `profile.userId === session.user.id`.
//
// GET (admin only) — list PENDING requests for the admin review queue.
import 'server-only';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import type { ZodError } from 'zod';
import { auth } from '@/lib/auth';
import {
  CreateVerificationRequest,
  type CreateVerificationRequestInput,
  VerificationRequestItem,
} from '@/lib/contracts/profiles';
import { prisma } from '@/lib/db';
import { requireAuth, type SessionUser } from '@/lib/require-auth';

export const dynamic = 'force-dynamic';

function flattenZod(error: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [field, messages] of Object.entries(error.flatten().fieldErrors)) {
    const message = messages?.[0];
    if (message) out[field] = message;
  }
  return out;
}

function toWire(r: {
  id: string;
  profileId: string;
  status: string;
  requestedAt: Date;
  decidedAt: Date | null;
  requestedDocumentsText: string | null;
  reviewerNote: string | null;
  reviewedByUserId: string | null;
}) {
  return VerificationRequestItem.parse({
    id: r.id,
    profileId: r.profileId,
    status: r.status as 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'REJECTED',
    requestedAt: r.requestedAt.toISOString(),
    decidedAt: r.decidedAt?.toISOString() ?? null,
    requestedDocumentsText: r.requestedDocumentsText,
    reviewerNote: r.reviewerNote,
    reviewedByUserId: r.reviewedByUserId,
  });
}

async function loadSession(): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user ?? null;
}

function deny(): Response {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

export async function POST(req: Request) {
  let user: SessionUser;
  try {
    user = await requireAuth();
  } catch (res) {
    return res as Response;
  }
  try {
    const parsed = CreateVerificationRequest.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ errors: flattenZod(parsed.error) }, { status: 400 });
    }
    const data: CreateVerificationRequestInput = parsed.data;
    const profile = await prisma.profile.findUnique({ where: { userId: user.id } });
    if (!profile) {
      return NextResponse.json({ error: 'No profile to verify' }, { status: 404 });
    }
    // Idempotent guard: if the most recent open request is already PENDING, 409.
    const open = await prisma.verificationRequest.findFirst({
      where: { profileId: profile.id, status: 'PENDING' },
      orderBy: { requestedAt: 'desc' },
    });
    if (open) {
      return NextResponse.json(
        { error: 'A verification request is already pending', request: toWire(open) },
        { status: 409 },
      );
    }
    const created = await prisma.verificationRequest.create({
      data: {
        profileId: profile.id,
        status: 'PENDING',
        requestedDocumentsText: data.requestedDocumentsText,
      },
    });
    // Mirror the new status onto the Profile row so /u/[handle] reflects it
    // without a separate join.
    await prisma.profile.update({
      where: { id: profile.id },
      data: { verificationStatus: 'PENDING' },
    });
    return NextResponse.json({ request: toWire(created) }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function GET() {
  try {
    const user = await loadSession();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return deny();
    const rows = await prisma.verificationRequest.findMany({
      where: { status: 'PENDING' },
      orderBy: { requestedAt: 'asc' },
      take: 50,
    });
    return NextResponse.json({ items: rows.map(toWire) });
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
