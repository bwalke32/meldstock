// @polsia:user-owned — /api/threads/[threadId]/participants endpoint.
//
// GET:   full roster for a thread the caller participates in. Used by the
//        right-pane on the dashboard messages inbox so the participant list
//        can render before the participant-add form is interacted with.
//        Auth: any current participant; otherwise 403.
//
// POST:  add a logged-in user to the thread's roster by EITHER their
//        account email OR a unique company name on their profile. Match
//        precedence: email (case-insensitive) WIN — falls back to a unique
//        `Profile.companyName` match. Multi-match company names are a 409
//        (the disambiguation hint asks the caller to retry by email).
//        Caller (auth gate + participant gate) must already be on the
//        roster; a non-participant gets 403. Self / already-in-thread
//        attempts return 409. Auth: requireAuth.
import 'server-only';
import { NextResponse } from 'next/server';
import {
  isThreadParticipant,
  loadParticipants,
  resolveParticipantByIdentifier,
} from '@/lib/business/thread-participants';
import {
  CreateParticipant,
  type ParticipantItem,
  ParticipantList as ParticipantListSchema,
} from '@/lib/contracts/messaging';
import { prisma } from '@/lib/db';
import { requireAuth, type SessionUser } from '@/lib/require-auth';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ threadId: string }> }) {
  let user: SessionUser;
  try {
    user = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  let threadId: string;
  try {
    const params = await ctx.params;
    threadId = params.threadId;
  } catch {
    return NextResponse.json({ error: 'Bad Request' }, { status: 400 });
  }

  try {
    const thread = await prisma.messageThread.findUnique({
      where: { id: threadId },
      select: { id: true, buyerId: true, sellerId: true, createdAt: true },
    });
    if (!thread) {
      return NextResponse.json({ error: 'Not Found' }, { status: 404 });
    }
    const participant = await isThreadParticipant(thread, user.id);
    if (!participant) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const items = await loadParticipants(thread);
    return NextResponse.json(ParticipantListSchema.parse({ items }));
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ threadId: string }> }) {
  let user: SessionUser;
  try {
    user = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  let threadId: string;
  try {
    const params = await ctx.params;
    threadId = params.threadId;
  } catch {
    return NextResponse.json({ error: 'Bad Request' }, { status: 400 });
  }

  let body: { identifier: string };
  try {
    const parsed = CreateParticipant.safeParse(await req.json());
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const [field, messages] of Object.entries(parsed.error.flatten().fieldErrors)) {
        const message = messages?.[0];
        if (message) errors[field] = message;
      }
      return NextResponse.json({ errors }, { status: 400 });
    }
    body = parsed.data;
  } catch {
    return NextResponse.json({ error: 'Bad Request' }, { status: 400 });
  }

  try {
    const thread = await prisma.messageThread.findUnique({
      where: { id: threadId },
      select: { id: true, buyerId: true, sellerId: true, createdAt: true },
    });
    if (!thread) {
      return NextResponse.json({ error: 'Not Found' }, { status: 404 });
    }
    const participant = await isThreadParticipant(thread, user.id);
    if (!participant) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // The lookup call rejects users who are already on the roster; build
    // the set so we don't fetch the full roster just to ask
    // `resolveParticipantByIdentifier`. Buyer/seller may be null on a
    // broker-group room — drop the nulls before constructing the set.
    const existingIds = new Set<string>(
      [thread.buyerId, thread.sellerId].filter((v): v is string => v !== null),
    );
    const existing = await prisma.threadParticipant.findMany({
      where: { threadId: thread.id },
      select: { userId: true },
    });
    for (const row of existing) {
      existingIds.add(row.userId);
    }

    const resolved = await resolveParticipantByIdentifier(body.identifier, existingIds);
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status });
    }

    // Idempotent insert — composite PK. A second add of the same user re-
    // turns 201 with the existing row's timestamp (no surface-level
    // surprise to the caller).
    const addedAt = new Date();
    await prisma.threadParticipant.upsert({
      where: { threadId_userId: { threadId: thread.id, userId: resolved.userId } },
      update: {},
      create: {
        threadId: thread.id,
        userId: resolved.userId,
        addedBy: user.id,
        addedAt,
      },
    });

    // Resolve the profile fields so we can return the new ParticipantItem
    // in the same wire shape used elsewhere. Single batch with the caller's
    // own profile (used as `addedByDisplayName`).
    const [profile, adderProfile] = await Promise.all([
      prisma.profile.findUnique({
        where: { userId: resolved.userId },
        select: { displayName: true, companyName: true, handle: true },
      }),
      prisma.profile.findUnique({
        where: { userId: user.id },
        select: { displayName: true },
      }),
    ]);

    const newItem: ParticipantItem = {
      userId: resolved.userId,
      displayName: profile?.displayName ?? 'User',
      companyName: profile?.companyName ?? null,
      handle: profile?.handle ?? null,
      addedAt: addedAt.toISOString(),
      addedByDisplayName: adderProfile?.displayName ?? null,
    };

    return NextResponse.json(newItem, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
