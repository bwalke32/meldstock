// @polsia:user-owned — shared per-lot visibility gate. Called by the `/api/lots`
// resources (browse, detail, comparables, messages) so every consumer answers
// the same question with the same logic. The lot NEVER reaches the wire if
// the viewer is not entitled to it — even the EXISTENCE is hidden, matching
// the existing VERIFIED_COMPANIES_ONLY pattern.
//
// Two tiers are added on top of PUBLIC / VERIFIED_COMPANIES_ONLY / ANONYMOUS:
//   - MY_NETWORK: only users connected to the poster (canonical-pair row in
//     the `Connection` table — see prisma/schema/connections.prisma).
//   - SELECTED_COMPANIES: only viewers whose profile handle OR auth user
//     lowercase email appears in `Lot.selectedCompanyIdentifiers`. The list
//     is free-form text typed at posting time; if the mailer misspells a
//     handle/email, the recipient is silently invisible (documented). A
//     missing profile still matches by email alone — viewers don't need to
//     complete their profile to be reached by a SelectedCompanies lot.
//
// Computed across a single batch (no per-row lookup) so the /lots browse
// stays O(1) round-trips: ONE `connection.findMany` for the viewer's network
// up-front, ONE `user.findMany` for the viewer's email, then in-memory
// gating for the whole page.
//
// Server-only — imports Prisma + NextResponse; only API handlers touch it.
import 'server-only';
import { NextResponse } from 'next/server';
import { asStringArray } from '@/lib/business/profiles';
import type { LotVisibility } from '@/lib/contracts/lots';
import { prisma } from '@/lib/db';

// Wire-side identity stamp for ANONYMOUS listings — replaces the seller
// identifying fields with safe defaults so the wire shape can't leak the
// real poster. Spread BEFORE LotItem.parse so the parse validates the
// already-scrubbed wire. Single source of truth so the GET / detail /
// comparables handlers can never drift on the label.
export const ANONYMOUS_SCRUB = {
  postedByName: 'Meldstock-verified seller',
  postedByUserId: null,
  postedByHandle: null,
} as const;

export type LotLike = {
  id: string;
  postedByUserId: string | null;
  visibility: string;
  selectedCompanyIdentifiers?: unknown;
};

export type VisibilityViewer = {
  /** null for anonymous viewers. */
  userId: string | null;
  /** Viewer email from auth, lowercased — used by the SELECTED_COMPANIES match. */
  emailLower: string | null;
  /** Viewer profile handle, lowercased — used by the SELECTED_COMPANIES match. */
  handleLower: string | null;
  /** Whether the viewer's profile is verified (VERIFIED_COMPANIES_ONLY gate). */
  verified: boolean;
  /**
   * All `Connection.userIdB` (or `userIdA`) values that the viewer is paired
   * with. Pre-computed by the caller with a single `connection.findMany`.
   */
  networkUserIds: Set<string>;
};

/**
 * Resolve a viewer's gating context. Called ONCE per /api/lots request so
 * `networkUserIds` / `handleLower` / `emailLower` are single round-trips.
 * Anonymous viewers (no session) get a fully-empty context — they only see
 * PUBLIC + ANONYMOUS rows.
 */
export async function resolveVisibilityViewer(userId: string | null): Promise<VisibilityViewer> {
  if (!userId) {
    return {
      userId: null,
      emailLower: null,
      handleLower: null,
      verified: false,
      networkUserIds: new Set<string>(),
    };
  }
  const [user, profile, networkRows] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
    prisma.profile.findUnique({
      where: { userId },
      select: { handle: true, verificationStatus: true },
    }),
    prisma.connection.findMany({
      where: { OR: [{ userIdA: userId }, { userIdB: userId }] },
      select: { userIdA: true, userIdB: true },
    }),
  ]);
  const networkUserIds = new Set<string>();
  for (const row of networkRows) {
    if (row.userIdA !== userId) networkUserIds.add(row.userIdA);
    if (row.userIdB !== userId) networkUserIds.add(row.userIdB);
  }
  return {
    userId,
    emailLower: user?.email ? user.email.toLowerCase() : null,
    handleLower: profile?.handle ? profile.handle.toLowerCase() : null,
    verified: profile?.verificationStatus === 'VERIFIED',
    networkUserIds,
  };
}

/**
 * Predicate used by the browse filter — returns whether a single row is
 * visible to the given viewer. Pure (no DB); the caller hands us a fully
 * resolved `visibilityViewer`.
 */
function isLotVisibleTo(row: LotLike, viewer: VisibilityViewer): boolean {
  const visibility = row.visibility as LotVisibility;
  switch (visibility) {
    case 'PUBLIC':
    case 'ANONYMOUS':
      return true;
    case 'VERIFIED_COMPANIES_ONLY':
      return viewer.verified;
    case 'MY_NETWORK': {
      if (!viewer.userId) return false;
      // Connection rows do not record requester/acceptance state. Until the
      // proposed request/accept migration is approved, this tier fails
      // closed for everyone except the listing owner.
      return row.postedByUserId === viewer.userId;
    }
    case 'SELECTED_COMPANIES': {
      if (!viewer.userId) return false;
      if (row.postedByUserId === viewer.userId) return true;
      const identifiers = asStringArray(row.selectedCompanyIdentifiers) ?? [];
      if (identifiers.length === 0) return false;
      if (viewer.handleLower && identifiers.includes(viewer.handleLower)) return true;
      if (viewer.emailLower && identifiers.includes(viewer.emailLower)) return true;
      return false;
    }
    default:
      // Unknown visibility value: fail closed (hide) rather than leak.
      return false;
  }
}

/**
 * Apply the visibility gate to a list of browse results. Returns ONLY the
 * rows visible to the viewer, plus the set of poster userIds (caller can
 * reuse for the batched profile lookup — duplicates trimmed upstream).
 *
 * Stamps `selectedCompanyIdentifiers` to null on every SELECTED_COMPANIES
 * row the viewer was NOT specifically permitted to see. We only reveal the
 * inbox to viewers who were themselves allowed in — never to third parties
 * who can browse /lots but can't open the row.
 */
export function resolveViewerAccess<R extends LotLike>(rows: R[], viewer: VisibilityViewer): R[] {
  const visible: R[] = [];
  for (const row of rows) {
    if (!isLotVisibleTo(row, viewer)) continue;
    if (row.visibility === 'SELECTED_COMPANIES') {
      // Only recipient-poster or recipients in the list can see the list —
      // the helper strips the inbox everywhere else.
      const isPoster = row.postedByUserId === viewer.userId;
      const identifiers = asStringArray(row.selectedCompanyIdentifiers) ?? [];
      const isListed =
        !isPoster &&
        ((viewer.handleLower !== null && identifiers.includes(viewer.handleLower)) ||
          (viewer.emailLower !== null && identifiers.includes(viewer.emailLower)));
      if (!isPoster && !isListed) {
        visible.push({ ...row, selectedCompanyIdentifiers: null });
        continue;
      }
    }
    visible.push(row);
  }
  return visible;
}

/**
 * Detail-route variant — returns a 404 `NextResponse` if the lot is NOT
 * visible to the viewer, or `null` if it IS visible. Permission is binary
 * by design (existence is hidden). Use this from `[id]/route.ts`,
 * `[id]/comparables/route.ts`, `[id]/messages/route.ts`, etc.
 */
export function lotBlockedResponse(
  row: LotLike | null,
  viewer: VisibilityViewer,
): NextResponse | null {
  if (!row) {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  }
  if (!isLotVisibleTo(row, viewer)) {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  }
  return null;
}

/**
 * Predicate for the saved-search fan-out. Same resolver logic as the
 * browse gate so a MY_NETWORK lot never notifies a viewer whose
 * connection row is missing — only the renderer's id-set is consulted.
 */
export function isRecipientEligible(
  row: LotLike,
  viewer: {
    userId: string | null;
    verified: boolean;
    networkUserIds: Set<string>;
    emailLower: string | null;
    handleLower: string | null;
  },
): boolean {
  return isLotVisibleTo(row, viewer);
}
