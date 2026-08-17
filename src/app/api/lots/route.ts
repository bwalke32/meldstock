// @polsia:user-owned — /api/lots trading-floor + browse endpoint.
//
// GET:  most-recent N lots (N from ?limit, default 100, clamp 200). Optional
//       filter keys: type, polymer[], condition[], form, grade, color, q
//       (free-text across notes/manufacturer/grade/color), hasCoa. Mirrors
//       parseLotFilter. Each row is enriched with `postedByHandle` so the
//       detail page can link to /u/[handle].
//
//       Visibility enforcement (see prisma/schema/lots.prisma#LotVisibility):
//       PUBLIC + ANONYMOUS are always shown. VERIFIED_COMPANIES_ONLY lots
//       are shown only when the viewer is VERIFIED. MY_NETWORK + ANONYMOUS
//       are filtered against a single-batch `connection.findMany`. The full
//       rule set lives in @/lib/business/lot-visibility so every API route
//       answers the same question. ANONYMOUS lots scrub the seller identity
//       (postedByName → "Meldstock-verified seller", postedByUserId/Handle → null).
// POST: persist a new listing (HAVE or WANTED). A better-auth session is
//       required and ownership/display identity are derived server-side.
//       ANONYMOUS remains a viewer-facing visibility mode, not an ownerless
//       write. `visibility` defaults to PUBLIC at the
//       zod layer so legacy clients stay valid. When `visibility ===
//       'SELECTED_COMPANIES'`, `selectedCompanyIdentifiers` is required and
//       persisted as `Json` on the lot; otherwise the column is `null`.
//
//       After the create succeeds, fan out to SavedSearch: load every saved
//       search, evaluate the new lot against each filter using the same
//       semantics as `matchesLotFilter`, bucket matches per recipient user,
//       and send exactly one email per recipient — when several of a user's
//       searches match the same lot, they collapse into one notification
//       (so a user with 4 matching saved searches gets 1 email, not 4 — the
//       email-proxy rate-limit caps non-inbound sends at 50/day/app).
//       For MY_NETWORK + SELECTED_COMPANIES, recipient scoping mirrors the
//       visibility gate (network-only / identifier-list-only). Fan-out
//       failures are logged and never break the lot POST response.
//       WANTED-only: only WANTED posts fire the fan-out — HAVE posts skip
//       it. Same-day dedupe is enforced by `sentNotifications`, a sliding
//       24h in-memory map keyed on `hash(userId:lotId)`; a given (recipient,
//       lot) pair can be emailed at most once per 24h window, so any future
//       re-fan-out path (cron / retry) ships clean.
import 'server-only';
import { NextResponse } from 'next/server';
import { activeFilterCount, lotMatchesSavedSearch } from '@/lib/business/lot-filters';
import {
  ANONYMOUS_SCRUB,
  resolveViewerAccess,
  resolveVisibilityViewer,
} from '@/lib/business/lot-visibility';
import {
  recordSavedSearchMatch,
  stampNotification,
  tryClaimNotification,
} from '@/lib/business/notifications';
import { getTrustedPostingIdentity } from '@/lib/business/posting-identity';
import { asStringArray, type LotRow, lotRowToWire } from '@/lib/business/profiles';
import { normalizeResinInput, resolveResinRow } from '@/lib/business/resin-normalize';
import { CreateLot, LotItem, LotList } from '@/lib/contracts/lots';
import { LotFilter, lotFilterToParams, parseLotFilter } from '@/lib/contracts/lots-filters';
import { prisma } from '@/lib/db';
import { sendEmail } from '@/lib/email/send';
import { wantedSavedSearchMatchEmail } from '@/lib/email/templates';
import { getSessionUser, requireAuth, type SessionUser } from '@/lib/require-auth';

export const dynamic = 'force-dynamic';

// ANONYMOUS listings scrub the seller identity on the wire via the shared
// `ANONYMOUS_SCRUB` constant imported from @/lib/business/lot-visibility.
// Replaced this local copy so the GET / detail / comparables handlers can
// never drift on the "Meldstock-verified seller" label.

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const filter = parseLotFilter(url.searchParams);

    // Build the Prisma where clause from the subset of filter keys that map
    // to actual columns. Unknown keys (mfr range, glass %, recycled %,
    // flame, certs) live in `lot.notes` today — the handler accepts them
    // without 400-ing, but they're applied client-side in the browse
    // island. Unknown enum values are dropped at parse time, so casual
    // URLs with a typo still work.
    const where: Record<string, unknown> = {};
    if (filter.type !== 'ALL') {
      where.type = filter.type;
    }
    if (filter.conditions.length > 0) {
      where.condition = { in: filter.conditions };
    }
    if (filter.form) {
      // match by exact form name — case-insensitive in app.
      where.form = { equals: filter.form, mode: 'insensitive' };
    }
    // Resin terminology normalization on the search side. The
    // trade-floor brief asked for "buyer types `PA66 GF33 BK` and
    // picks up lots posted with `PA66 GF33`, `Polyamide 6,6 33%
    // GF`, or `PA66 GF33 BK`" — i.e. the search input is
    // interpreted as a structured shorthand matching multiple
    // columns, NOT a literal-grade substring match.
    //
    // Behaviour: the parsed polymers union into `filter.polymers`
    // for Prisma's `in:` clause; the parsed colour promotes into a
    // color-branch; the parsed canonical-grade (the leftover after
    // polymer/color/glass/flame lift) is unioned with the literal
    // input as an OR branch. None of the branches alone dominate —
    // a lot matches if its polymer OR grade-substring OR colour
    // matches any of them, then AND-combined against the canonical
    // filter set (type / condition / form / q).
    const parsedGrade = filter.grade ? normalizeResinInput(filter.grade, { mode: 'search' }) : null;
    const gradePolymers = parsedGrade?.polymers ?? [];
    const mergedPolymers = Array.from(new Set([...filter.polymers, ...gradePolymers]));
    if (mergedPolymers.length > 0) {
      where.polymer = { in: mergedPolymers };
    }
    // Build the OR branch group for `lot.grade` and `lot.color`.
    // Three cases that affect whether the literal-grade substring
    // branch fires:
    //   1. The input has a leftover canonical grade (`Lexan 141R` →
    //      polymer not recognised, but the literal still finds the
    //      lot) — include the literal-grade branch so the lot
    //      matches.
    //   2. The input ALSO contains a parsed color, so we want to
    //      match lots whose `lot.color` says `Black` even when
    //      `lot.grade` doesn't include the literal string —
    //      include both branches.
    //   3. The input is JUST the polymer token (`PA66`, `Nylon
    //      66`) — drop the literal-grade branch entirely so a lot
    //      posted with `Ultramid A27E` (no `PA66` substring in
    //      grade) still matches via the polymer `in:` clause.
    const shorthandBranches: Array<Record<string, unknown>> = [];
    const inputHasLeftover = parsedGrade !== null && parsedGrade.gradeCanonical !== null;
    const inputHasColor = parsedGrade !== null && parsedGrade.color !== null;
    const inputHasPolymers = parsedGrade !== null && parsedGrade.polymers.length > 0;
    const inputIsPurePolymer =
      parsedGrade !== null && !inputHasLeftover && !inputHasColor && inputHasPolymers;
    if (filter.grade && (inputHasLeftover || inputHasColor)) {
      shorthandBranches.push({
        grade: { contains: filter.grade, mode: 'insensitive' as const },
      });
    }
    if (inputHasLeftover && parsedGrade?.gradeCanonical !== filter.grade) {
      shorthandBranches.push({
        grade: { contains: parsedGrade.gradeCanonical, mode: 'insensitive' as const },
      });
    }
    if (inputHasColor) {
      shorthandBranches.push({
        color: { contains: parsedGrade?.color ?? '', mode: 'insensitive' as const },
      });
    }
    if (shorthandBranches.length > 0) {
      // The user's explicit `filter.color` unions into the same OR
      // group so a sidebar color chip still works alongside the
      // search-derived shorthand color.
      if (filter.color) {
        shorthandBranches.push({
          color: { contains: filter.color, mode: 'insensitive' as const },
        });
      }
      // Compose the existing constraints with the shorthand OR via
      // an outer AND so polymer / condition / form / status still
      // apply AND the grade-string match returns a superset.
      const existing = { ...where };
      for (const k of Object.keys(existing)) delete where[k];
      where.AND = [existing, { OR: shorthandBranches }];
    } else if (inputIsPurePolymer) {
      // Pure polymer input — the polymer `in:` clause already
      // matched; just include the explicit sidebar color when set
      // and leave grade empty.
      if (filter.color) {
        where.color = { contains: filter.color, mode: 'insensitive' };
      }
    } else if (filter.grade) {
      // Backward-compat fallback — neither the polymer match nor
      // any color/canonical-grade branch ran (input was totally
      // unrecognised, so parsedGrade carries the raw upper-case
      // back as gradeCanonical but no polymer/color lift). Mirror
      // the original substring behaviour.
      where.grade = { contains: filter.grade, mode: 'insensitive' };
    }
    if (filter.color) {
      // Applied alongside the polymer / shorthand branches; UI
      // never lands here when shorthandBranches ran (its else-if
      // already handled the explicit color case). Use a top-level
      // key so Prisma composes with the AND's outer OR cleanly.
      if (!where.AND) {
        where.color = { contains: filter.color, mode: 'insensitive' };
      }
    }
    if (filter.q) {
      // Free-text across notes/manufacturer/grade/color — Prisma's `OR` is
      // the right shape here. Each branch is its own contains so an empty
      // notes/grade still matches the others.
      where.OR = [
        { notes: { contains: filter.q, mode: 'insensitive' } },
        { manufacturer: { contains: filter.q, mode: 'insensitive' } },
        { grade: { contains: filter.q, mode: 'insensitive' } },
        { color: { contains: filter.q, mode: 'insensitive' } },
      ];
    }
    if (filter.hasCoa !== null) {
      where.hasCoa = filter.hasCoa;
    }
    if (filter.quantityMin !== null || filter.quantityMax !== null) {
      // Decimal `gte`/`lte` on quantityLb — Prisma accepts number ranges
      // against a Decimal column and coerces them.
      const quantityRange: Record<string, number> = {};
      if (filter.quantityMin !== null) quantityRange.gte = filter.quantityMin;
      if (filter.quantityMax !== null) quantityRange.lte = filter.quantityMax;
      where.quantityLb = quantityRange;
    }
    if (filter.location) {
      where.location = { contains: filter.location, mode: 'insensitive' };
    }

    const viewerUserId = (await getSessionUser())?.id ?? null;
    // Lifecycle filter — non-owning viewers see ONLY ACTIVE rows. The
    // poster (owner) sees their own rows in every status so the dashboard
    // can render "sold" / "expired" / "deactivated" badges. We apply the
    // owner-scope as an OR branch alongside the status === 'ACTIVE' branch
    // so a single round-trip can answer both questions.
    const lifecycleWhere: Record<string, unknown> =
      viewerUserId !== null
        ? { OR: [{ status: 'ACTIVE' as const }, { postedByUserId: viewerUserId }] }
        : { status: 'ACTIVE' as const };
    const rows = await prisma.lot.findMany({
      where: { ...where, ...lifecycleWhere },
      orderBy: { createdAt: 'desc' },
      take: filter.limit,
    });
    // Resolve the VIEWER'S GATE — one round-trip per resource (Network +
    // Profile + User email). Performed regardless of whether the page
    // contains MY_NETWORK / SELECTED_COMPANIES rows so the filter is
    // uniform: PUBLIC listings never get accidentally gated because the
    // batched resolve didn't run.
    const viewer = await resolveVisibilityViewer(viewerUserId);
    const visibleRows = resolveViewerAccess(rows, viewer);

    // Profile batch for the visible rows — poster handles + verification
    // status (for the wire), keyed by scalar FK.
    const userIdSet = new Set<string>();
    for (const r of visibleRows) {
      if (r.postedByUserId) userIdSet.add(r.postedByUserId);
    }
    const userIds = [...userIdSet];
    const profiles = userIds.length
      ? await prisma.profile.findMany({
          where: { userId: { in: userIds } },
          select: { userId: true, handle: true, verificationStatus: true, role: true },
        })
      : [];
    const byUserId = new Map(profiles.map((p) => [p.userId, p]));

    const items = visibleRows.flatMap((row) => {
      const profile = row.postedByUserId ? byUserId.get(row.postedByUserId) : null;
      // ANONYMOUS — scrub seller identity on the wire.
      const scrubbed =
        row.visibility === 'ANONYMOUS'
          ? { ...row, ...ANONYMOUS_SCRUB, profile: null }
          : { ...row, profile };
      return [LotItem.parse(lotRowToWire(scrubbed as unknown as LotRow))];
    });
    return NextResponse.json(LotList.parse({ items }));
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let user: SessionUser;
  try {
    user = await requireAuth(req);
  } catch (res) {
    return res as Response;
  }

  try {
    const parsed = CreateLot.safeParse(await req.json());
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const [field, messages] of Object.entries(parsed.error.flatten().fieldErrors)) {
        const message = messages?.[0];
        if (message) errors[field] = message;
      }
      return NextResponse.json({ errors }, { status: 400 });
    }
    const data = parsed.data;
    const postingIdentity = await getTrustedPostingIdentity(user);
    const postedByUserId = postingIdentity.userId;
    // Normalise the selected-company list — lowercase + trim + dedupe at
    // the API boundary so the read-side match is consistent regardless of
    // how a poster typed each entry. Persist ONLY when the visibility tier
    // requires it; otherwise write null to keep pricing + verification
    // queries free of irrelevant JSON.
    const cleanedSelected = normaliseSelectedIdentifiers(data.selectedCompanyIdentifiers);
    const selectedForPersistence =
      data.visibility === 'SELECTED_COMPANIES' ? cleanedSelected : null;
    // Lifecycle brief: `quantityRemaining` defaults from `quantityLb` at
    // create time so existing callers (the single-lot form + the CSV
    // bulk importer) can post without knowing about the column. The
    // PATCH endpoint accepts an explicit value when the poster wants to
    // ship a partial lot.
    const quantityRemaining =
      data.quantityRemaining !== undefined && data.quantityRemaining !== null
        ? Math.min(data.quantityRemaining, data.quantityLb)
        : data.quantityLb;
    // Resin terminology canonicalisation — runs AFTER the zod contract
    // (which already validates polymer as a strict PolymerEnum
    // canonical) so the same row posted via the single-form, the CSV
    // paste, or the upload wizard persists with identical `lot.grade`,
    // `lot.color`, and modifier tokens. The contract is the source of
    // truth for `lot.polymer`; this resolver strips modifier tokens
    // (e.g. `PA66 GF33 BK` → grade=" ") and lifts color shorthand
    // (`BK` → `Black`). A typed grade string that contains BOTH a
    // polymer alias AND a color shorthand promotes the color column
    // so a buyer searching by `Black` picks up the lot. The polymer
    // override only fires when the existing dropdown is `OTHER`.
    const resolved = resolveResinRow(data.polymer, data.grade ?? null, data.color);
    const persistedPolymer = resolved.polymer;
    const persistedGrade =
      resolved.grade !== null && resolved.grade.length > 0 ? resolved.grade : null;
    const persistedColor = resolved.color || data.color;
    const created = await prisma.lot.create({
      data: {
        type: data.type,
        polymer: persistedPolymer,
        condition: data.condition,
        color: persistedColor,
        form: data.form,
        manufacturer: data.manufacturer ?? null,
        grade: persistedGrade,
        quantityLb: data.quantityLb,
        packaging: data.packaging,
        location: data.location ?? null,
        country: data.country,
        askingPricePerLb: data.askingPricePerLb ?? null,
        hasCoa: data.hasCoa,
        notes: data.notes ?? null,
        postedByName: postingIdentity.displayName,
        postedByUserId,
        visibility: data.visibility,
        quantityRemaining,
        selectedCompanyIdentifiers: selectedForPersistence ?? undefined,
      },
    });
    // ANONYMOUS lots route contact exclusively through the per-lot public
    // thread, so the poster's identity is hidden on the response wire
    // (matches the GET scrub) — even on the just-created response so the
    // form's success card doesn't accidentally print the seller's real name.
    const profile = created.visibility !== 'ANONYMOUS' ? postingIdentity.profile : null;
    const scrubbed =
      created.visibility === 'ANONYMOUS'
        ? { ...created, ...ANONYMOUS_SCRUB, profile: null }
        : { ...created, profile };
    // Email-on-match fan-out (best-effort: failures log, never fail the POST).
    // Skipped when the post is anonymous OR by the lot's owner — sellers
    // shouldn't notify themselves. await so the response only returns after
    // the fan-out has settled (keeps the API deterministic for callers
    // building a follow-up UI). `void` would also work; awaiting matches the
    // existing style of `/api/saved-searches#POST`.
    void fanOutSavedSearchMatches(
      created.id,
      postedByUserId,
      created.visibility,
      asStringArray(created.selectedCompanyIdentifiers),
    ).catch(() => {});
    return NextResponse.json(LotItem.parse(lotRowToWire(scrubbed as unknown as LotRow)), {
      status: 201,
    });
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

function normaliseSelectedIdentifiers(raw: string[] | null | undefined): string[] {
  if (!raw || raw.length === 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    const trimmed = entry.trim().toLowerCase();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

// Eval a freshly-created lot against every SavedSearch. Bucket matches per
// recipient so a user with several matching searches still gets ONE email
// (rate-limit friendly). Owner self-notifications are skipped.
//
// For VERIFIED_COMPANIES_ONLY lots, only verified-company watchers get
// notified. For MY_NETWORK, only watchers whose Connection row pairs them
// with the poster. For SELECTED_COMPANIES, only watchers whose profile
// handle OR auth email appears in the lot's identifier list — otherwise
// the listing would leak through the email channel.
//
// Same-day dedupe is enforced by `sentNotifications`, a module-scoped
// Map<string, number> keyed on `${userId}:${lotId}` (value = epoch ms of
// the last successful send). Sliding 24h window, not "next 00:00 UTC" —
// matches the brief's "per day" wording while staying a wall-clock TTL.
// The Map and the claim/stamp helpers live in @/lib/business/notifications
// so the email AND the in-app notification row are gated by the SAME
// dedupe boundary — a fan-out retry cannot double-fire either path.

async function fanOutSavedSearchMatches(
  lotId: string,
  postedByUserId: string | null,
  visibility:
    | 'PUBLIC'
    | 'VERIFIED_COMPANIES_ONLY'
    | 'MY_NETWORK'
    | 'SELECTED_COMPANIES'
    | 'ANONYMOUS',
  selectedCompanyIdentifiers: string[] | null,
): Promise<void> {
  const lot = await prisma.lot.findUnique({ where: { id: lotId } });
  if (!lot) return;
  // ANONYMOUS listings are visible to anyone, but the seller is hidden —
  // notify watchers by email as usual.
  const searches = await prisma.savedSearch.findMany();
  if (searches.length === 0) return;
  // WANTED-only fan-out — HAVE postings don't notify saved-search watchers.
  if (lot.type !== 'WANTED') return;

  type Bucket = {
    userId: string;
    savedSearchIds: string[];
    savedSearchNames: string[];
    matchedFilters: number;
    // First matching filter — used to build the one-click URL back into
    // /lots with the saved filter pre-applied.
    sampleFilter: ReturnType<typeof LotFilter.parse> | null;
  };
  const buckets = new Map<string, Bucket>();

  for (const row of searches) {
    // Skip disabled alerts — same semantics as a non-match, so the rest of
    // the fan-out pipeline (visibility scoping, email dedupe) doesn't need
    // to know about the toggle.
    if (!row.alertEnabled) continue;
    const filter = (() => {
      try {
        return LotFilter.parse(row.filterJson);
      } catch {
        return null;
      }
    })();
    if (!filter) continue;
    if (!lotMatchesSavedSearch(lot, filter)) continue;
    const key = row.userId;
    const existing = buckets.get(key) ?? {
      userId: key,
      savedSearchIds: [],
      savedSearchNames: [],
      matchedFilters: 0,
      sampleFilter: filter,
    };
    existing.savedSearchIds.push(row.id);
    existing.savedSearchNames.push(row.name);
    existing.matchedFilters += activeFilterCount(filter);
    buckets.set(key, existing);
  }

  // Don't notify the seller. Subsequent restriction narrows the
  // recipient set further so a private lot can't leak through fan-out.
  let recipientUserIds = [...buckets.keys()].filter((id) => id !== postedByUserId);
  if (recipientUserIds.length === 0) return;

  if (
    visibility === 'VERIFIED_COMPANIES_ONLY' ||
    visibility === 'MY_NETWORK' ||
    visibility === 'SELECTED_COMPANIES'
  ) {
    const profiles = await prisma.profile.findMany({
      where: { userId: { in: recipientUserIds } },
      select: {
        userId: true,
        handle: true,
        verificationStatus: true,
      },
    });
    const verifiedProfiles = profiles.filter((p) => p.verificationStatus === 'VERIFIED');
    const verifiedUserIds = new Set(verifiedProfiles.map((p) => p.userId));

    if (visibility === 'VERIFIED_COMPANIES_ONLY') {
      recipientUserIds = recipientUserIds.filter((id) => verifiedUserIds.has(id));
    } else if (visibility === 'MY_NETWORK') {
      if (!postedByUserId) return;
      const acceptedConnections = await prisma.connection.findMany({
        where: {
          status: 'ACCEPTED',
          OR: [
            { userIdA: postedByUserId, userIdB: { in: recipientUserIds } },
            { userIdB: postedByUserId, userIdA: { in: recipientUserIds } },
          ],
        },
        select: { userIdA: true, userIdB: true },
      });
      const acceptedRecipientIds = new Set(
        acceptedConnections.map((row) =>
          row.userIdA === postedByUserId ? row.userIdB : row.userIdA,
        ),
      );
      recipientUserIds = recipientUserIds.filter((id) => acceptedRecipientIds.has(id));
    } else {
      // SELECTED_COMPANIES — match by profile handle OR auth user email.
      const identifierSet = new Set(
        (selectedCompanyIdentifiers ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean),
      );
      if (identifierSet.size === 0) return;
      const handleMap = new Map(profiles.map((p) => [p.userId, p.handle?.toLowerCase() ?? null]));
      const handleCandidates = recipientUserIds.filter((id) => {
        const h = handleMap.get(id);
        return h !== null && h !== undefined && identifierSet.has(h);
      });
      const needEmailLookup = recipientUserIds.filter((id) => !handleCandidates.includes(id));
      const emailMatches = needEmailLookup.length
        ? await prisma.user.findMany({
            where: { id: { in: needEmailLookup } },
            select: { id: true, email: true },
          })
        : [];
      const emailMatchedIds = emailMatches
        .filter((u) => u.email && identifierSet.has(u.email.toLowerCase()))
        .map((u) => u.id);
      recipientUserIds = [...handleCandidates, ...emailMatchedIds];
    }
    if (recipientUserIds.length === 0) return;
  }

  const recipientUsers = await prisma.user.findMany({
    where: { id: { in: recipientUserIds } },
    select: { id: true, email: true, name: true },
  });
  if (recipientUsers.length === 0) return;

  const lotSummary = lotSummaryLine(lot);
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '') ?? '';

  await Promise.allSettled(
    recipientUsers.map(async (u) => {
      const bucket = buckets.get(u.id);
      if (!bucket) return;
      // Same-day dedupe — drop the recipient if we already fanned out to
      // them about this lot within the last 24h. The claim MUST happen
      // before either side-effect fires so BOTH the email AND the
      // notification row are gated by the same boundary (a retry cannot
      // double-write to either channel).
      if (!tryClaimNotification(u.id, lotId)) {
        return;
      }
      // Use the SAME filter from the bucket so the email link lands the user
      // on the lot set they were watching when the match fired.
      const params = bucket.sampleFilter ? lotFilterToParams(bucket.sampleFilter).toString() : '';
      const matchesUrl = `${baseUrl}/lots${params.length > 0 ? `?${params}` : ''}`;
      const primaryName = bucket.savedSearchNames[0] ?? 'your saved search';
      // Stamp on EITHER success path so a retry that re-writes the
      // notification row after a failed email can't re-fire the email,
      // AND a retry that re-fires the email after a failed notification
      // can't double-write the row. Falls back to "neither succeeded →
      // un-stamped → retry can re-attempt both".
      let firedAtLeastOnce = false;
      try {
        await sendEmail({
          to: u.email,
          ...wantedSavedSearchMatchEmail({
            user: { name: u.name },
            savedSearchName: primaryName,
            lotSummary,
            matchesUrl,
            matchedFiltersCount: bucket.matchedFilters,
          }),
        });
        firedAtLeastOnce = true;
      } catch {
        // Swallow per-recipient sends — they can't poison the fan-out.
      }
      try {
        await recordSavedSearchMatch(u.id, lotId, bucket.savedSearchNames, bucket.sampleFilter);
        firedAtLeastOnce = true;
      } catch {
        // DB hiccup — we still stamp below if the email succeeded, so a
        // retry is bounded by at least one successfully-delivered channel.
      }
      if (firedAtLeastOnce) {
        stampNotification(u.id, lotId);
        // Stamp `lastAlertSentAt` on each matched saved-search row so the
        // /dashboard/saved-searches "last alert" column shows the genuine
        // delivery time. Best-effort — an update hiccup must not break the
        // email/notification fan-out path that already succeeded.
        await Promise.allSettled(
          bucket.savedSearchIds.map((searchId) =>
            prisma.savedSearch
              .update({
                where: { id: searchId },
                data: { lastAlertSentAt: new Date() },
              })
              .catch(() => undefined),
          ),
        );
      }
    }),
  );
}

function lotSummaryLine(lot: {
  polymer: string;
  condition: string;
  form: string;
  manufacturer: string | null;
  grade: string | null;
  color: string;
  quantityLb: unknown;
}): string {
  const sku = [lot.polymer, lot.condition].filter(Boolean).join(' · ');
  const name = [lot.manufacturer, lot.grade].filter(Boolean).join(' ');
  const qty = lot.quantityLb?.toString?.() ?? String(lot.quantityLb ?? '');
  const qtyNum = Number.parseFloat(qty);
  const qtyText =
    Number.isFinite(qtyNum) && qtyNum > 0 ? `${qtyNum.toLocaleString('en-US')} lb` : '';
  return [sku, name, lot.color, lot.form, qtyText].filter(Boolean).join(' — ');
}
