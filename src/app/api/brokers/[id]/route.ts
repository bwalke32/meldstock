// @polsia:user-owned — /api/brokers/[id]. Public broker-profile lookup.
//
// Source of truth: Profile.userId AND Profile.role === 'BROKER_TRADER'. The
// brief's "broker-attached" surface keeps the gate lax at v1 — every signup
// starts as a BROKER_TRADER (see auth-config.ts#ensureProfile), and we don't
// refine on count > 0 so a freshly-signed-up broker still has a marketing
// page. 404 on missing profile OR a non-BROKER_TRADER role (no leak of the
// underlying identity to callers who arrive by guessing a user id).
//
// Counters are batch-resolved in a single Promise.all alongside the profile
// fetch so the wire stamps in one round-trip:
//
//   - activeListingsCount: Lot rows with `postedByUserId === id` and
//     `status === 'ACTIVE'`. Drives the "active" tile on the broker card.
//
//   - closedDealsCount: MessageThread rows where the user is buyer OR seller
//     AND `status === 'COMPLETED'`. The brief's "as intermediary" maps to
//     "any closed thread the broker is a party on" since MessageThread has
//     no intermediaryUserId column (the broker IS one of buyer/seller when
//     the deal sits on the platform).
import 'server-only';
import { NextResponse } from 'next/server';
import { type ProfileRow, profileRowToWire } from '@/lib/business/profiles';
import { BrokerProfileResponse as BrokerProfileResponseSchema } from '@/lib/contracts/brokers';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!id || id.length > 80) {
      return NextResponse.json({ error: 'Bad id' }, { status: 400 });
    }

    const [profile, activeListingsCount, closedDealsCount] = await Promise.all([
      prisma.profile.findUnique({ where: { userId: id } }),
      prisma.lot.count({
        where: { postedByUserId: id, status: 'ACTIVE' },
      }),
      prisma.messageThread.count({
        where: {
          status: 'COMPLETED',
          OR: [{ buyerId: id }, { sellerId: id }],
        },
      }),
    ]);

    if (!profile || profile.role !== 'BROKER_TRADER') {
      // 404 — don't leak the existence of a non-broker profile to callers
      // who arrive with a guessed user id.
      return NextResponse.json({ error: 'Not Found' }, { status: 404 });
    }

    // Only the marketing-safe subset goes on the wire. The full profile
    // surface (phone / publicEmail / websiteUrl / companyDescription) is
    // reachable via /u/[handle] instead — broker-page is the marketing
    // landing, not the private dossier. The narrower BrokerProfileResponse
    // schema omits those fields, so a `.parse` selects them out structurally.
    const wire = profileRowToWire(profile as ProfileRow);

    const response = BrokerProfileResponseSchema.parse({
      item: {
        id: wire.id,
        userId: wire.userId,
        displayName: wire.displayName,
        handle: wire.handle,
        companyName: wire.companyName,
        role: wire.role,
        accountType: wire.accountType,
        verifiedBadge: wire.verifiedBadge,
        verifiedCompany: wire.verifiedBadge === 'verified',
        memberSince: wire.createdAt,
        activeListingsCount,
        closedDealsCount,
      },
    });

    return NextResponse.json(response);
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
