// @polsia:user-owned — `/api/connections` ("My network") endpoints.
//
// GET  → list the caller's accepted connections, denormalised into
//        `{ items: [{ connectionUserId, identifier, identifierKind,
//        handle, displayName, companyName, email, createdAt }] }`. Each row
//        describes the COUNTERPARTY (the other half of the canonical pair)
//        so the client island can show "Bob @ Acme Polymers (added Apr 5)".
// POST → add a connection by HANDLE or EMAIL. The server tries a profile
//        handle lookup first, falls back to auth-user email. Adding the same
//        identifier twice is idempotent (200 instead of 201).
// DELETE → remove a connection by identifier.
//
// All three verbs are owner-scoped — viewers can ONLY see / mutate their own
// network; there is no admin master view in v1.
//
// Connection rows live in `Connection(userIdA, userIdB)` with the canonical
// a < b invariant; the server normalises on write so a single unique
// constraint holds the pair key. Resolving an arbitrary `identifier` to a
// user id is the only place the canonicalisation is computed.
import 'server-only';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import {
  ConnectionActionResponse,
  ConnectionList,
  CreateConnectionInput,
  RemoveConnectionInput,
} from '@/lib/contracts/connections';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Canonical pair ordering — every Connection row stores (a < b). Resolving
// ANY identifier returns a pair (a, b) regardless of which side the caller
// occupies — the DB can find the row from either direction via the two
// indexes on `userIdA` / `userIdB`.
function pairKey(a: string, b: string): { userIdA: string; userIdB: string } {
  return a < b ? { userIdA: a, userIdB: b } : { userIdA: b, userIdB: a };
}

function otherParty(row: { userIdA: string; userIdB: string }, me: string): string {
  return row.userIdA === me ? row.userIdB : row.userIdA;
}

// Strip a leading `@` from handles so the public form can write `@acme` or
// `acme` interchangeably. Email-shaped identifiers pass through untouched.
function normaliseHandle(input: string): string {
  const t = input.trim().toLowerCase();
  return t.startsWith('@') ? t.slice(1) : t;
}

function looksLikeEmail(input: string): boolean {
  return /.+@.+\..+/.test(input.trim());
}

async function resolveIdentifier(
  meUserId: string,
  identifier: string,
): Promise<
  | {
      ok: true;
      targetUserId: string;
      profile: {
        userId: string;
        handle: string;
        displayName: string;
        companyName: string | null;
      } | null;
      user: { id: string; email: string; name: string };
      identifierKind: 'HANDLE' | 'EMAIL';
      identifier: string;
    }
  | { ok: false; reason: 'NOT_FOUND' | 'SELF' }
> {
  const meProfile = await prisma.profile.findUnique({
    where: { userId: meUserId },
    select: { handle: true },
  });
  const raw = identifier.trim();
  const normalised = raw.toLowerCase();
  // Decide where to look — an email-shaped string always wins over handle;
  // otherwise try handle first (cheap index hit) and fall back to email.
  const tryHandleFirst = !looksLikeEmail(raw);
  for (const strategy of tryHandleFirst ? ['HANDLE', 'EMAIL'] : ['EMAIL', 'HANDLE']) {
    if (strategy === 'HANDLE') {
      const handle = normaliseHandle(raw);
      if (!handle) continue;
      const profile = await prisma.profile.findUnique({ where: { handle } });
      if (!profile) continue;
      if (profile.userId === meUserId) {
        return { ok: false, reason: 'SELF' };
      }
      if (meProfile?.handle && meProfile.handle === profile.handle) {
        return { ok: false, reason: 'SELF' };
      }
      const user = await prisma.user.findUnique({ where: { id: profile.userId } });
      if (!user) continue;
      return {
        ok: true,
        targetUserId: profile.userId,
        profile: {
          userId: profile.userId,
          handle: profile.handle,
          displayName: profile.displayName,
          companyName: profile.companyName,
        },
        user: { id: user.id, email: user.email, name: user.name },
        identifierKind: 'HANDLE',
        identifier: handle,
      };
    }
    // EMAIL strategy
    const user = await prisma.user.findUnique({ where: { email: normalised } });
    if (!user) continue;
    if (user.id === meUserId) {
      return { ok: false, reason: 'SELF' };
    }
    const profile = await prisma.profile.findUnique({
      where: { userId: user.id },
    });
    return {
      ok: true,
      targetUserId: user.id,
      profile: profile
        ? {
            userId: profile.userId,
            handle: profile.handle,
            displayName: profile.displayName,
            companyName: profile.companyName,
          }
        : null,
      user: { id: user.id, email: user.email, name: user.name },
      identifierKind: 'EMAIL',
      identifier: normalised,
    };
  }
  return { ok: false, reason: 'NOT_FOUND' };
}

async function requireSessionUserId(): Promise<{ userId: string } | { response: Response }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return {
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }
  return { userId: session.user.id };
}

function flattenZodErrors(error: import('zod').ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [field, messages] of Object.entries(error.flatten().fieldErrors)) {
    const message = messages?.[0];
    if (message) out[field] = message;
  }
  return out;
}

export async function GET() {
  const authed = await requireSessionUserId();
  if ('response' in authed) return authed.response;
  const me = authed.userId;
  try {
    const rows = await prisma.connection.findMany({
      where: { OR: [{ userIdA: me }, { userIdB: me }] },
      orderBy: { createdAt: 'desc' },
    });
    if (rows.length === 0) {
      return NextResponse.json(ConnectionList.parse({ items: [] }));
    }
    const otherIds = [...new Set(rows.map((r) => otherParty(r, me)))];
    const [profiles, users] = await Promise.all([
      prisma.profile.findMany({
        where: { userId: { in: otherIds } },
        select: {
          userId: true,
          handle: true,
          displayName: true,
          companyName: true,
        },
      }),
      prisma.user.findMany({
        where: { id: { in: otherIds } },
        select: { id: true, email: true, name: true },
      }),
    ]);
    const profileById = new Map(profiles.map((p) => [p.userId, p]));
    const userById = new Map(users.map((u) => [u.id, u]));
    const items = rows.map((row) => {
      const counterId = otherParty(row, me);
      const profile = profileById.get(counterId);
      const user = userById.get(counterId);
      // Prefer handle as the visible identifier — falls back to email only
      // when no profile exists yet (the target has signed up but
      // hasn't completed their profile, but we still allow the
      // email-keyed lookup).
      const identifierKind = profile ? 'HANDLE' : 'EMAIL';
      const identifier = profile?.handle.toLowerCase() ?? user?.email.toLowerCase() ?? counterId;
      return {
        id: row.id,
        connectionUserId: counterId,
        identifier,
        identifierKind: identifierKind as 'HANDLE' | 'EMAIL',
        handle: profile?.handle ?? null,
        displayName: profile?.displayName ?? user?.name ?? null,
        companyName: profile?.companyName ?? null,
        email: user?.email.toLowerCase() ?? null,
        createdAt: row.createdAt.toISOString(),
      };
    });
    return NextResponse.json(ConnectionList.parse({ items }));
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const authed = await requireSessionUserId();
  if ('response' in authed) return authed.response;
  const me = authed.userId;
  try {
    const parsed = CreateConnectionInput.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ errors: flattenZodErrors(parsed.error) }, { status: 400 });
    }
    const resolution = await resolveIdentifier(me, parsed.data.identifier);
    if (!resolution.ok) {
      if (resolution.reason === 'SELF') {
        return NextResponse.json(
          { error: "You can't add yourself to your network." },
          { status: 400 },
        );
      }
      return NextResponse.json(
        { error: 'No member matches that handle or email.' },
        { status: 404 },
      );
    }
    const pair = pairKey(me, resolution.targetUserId);
    const existing = await prisma.connection.findUnique({
      where: { userIdA_userIdB: pair },
    });
    if (existing) {
      return NextResponse.json(ConnectionActionResponse.parse({ ok: true, count: 0 }), {
        status: 200,
      });
    }
    await prisma.connection.create({
      data: pair,
    });
    return NextResponse.json(ConnectionActionResponse.parse({ ok: true, count: 1 }), {
      status: 201,
    });
  } catch (err) {
    // Treat the unique-constraint path as idempotent — a concurrent add
    // collapses to the same outcome (200).
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('Unique constraint')) {
      return NextResponse.json(ConnectionActionResponse.parse({ ok: true, count: 0 }), {
        status: 200,
      });
    }
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const authed = await requireSessionUserId();
  if ('response' in authed) return authed.response;
  const me = authed.userId;
  try {
    const parsed = RemoveConnectionInput.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ errors: flattenZodErrors(parsed.error) }, { status: 400 });
    }
    const resolution = await resolveIdentifier(me, parsed.data.identifier);
    if (!resolution.ok) {
      return NextResponse.json(
        { error: 'No member matches that handle or email.' },
        { status: 404 },
      );
    }
    const pair = pairKey(me, resolution.targetUserId);
    const result = await prisma.connection.deleteMany({
      where: pair,
    });
    if (result.count === 0) {
      return NextResponse.json({ error: 'Not in your network' }, { status: 404 });
    }
    return NextResponse.json(ConnectionActionResponse.parse({ ok: true, count: result.count }));
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
