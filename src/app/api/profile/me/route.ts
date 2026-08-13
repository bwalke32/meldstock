// @polsia:user-owned — shorthand for the "current user" profile lookup.
// Same shape as /api/profile GET but the resource path symmetry makes it
// trivial to wire client islands to a stable /api/profile/me URL.
import 'server-only';
import { NextResponse } from 'next/server';
import { type ProfileRow, profileRowToWire } from '@/lib/business/profiles';
import { ProfileItem } from '@/lib/contracts/profiles';
import { prisma } from '@/lib/db';
import { requireAuth, type SessionUser } from '@/lib/require-auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  let user: SessionUser;
  try {
    user = await requireAuth();
  } catch (res) {
    return res as Response;
  }
  try {
    const row = await prisma.profile.findUnique({ where: { userId: user.id } });
    if (!row) return NextResponse.json({ profile: null });
    return NextResponse.json({ profile: ProfileItem.parse(profileRowToWire(row as ProfileRow)) });
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
