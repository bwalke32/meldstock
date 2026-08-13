// @polsia:user-owned — GET /api/dashboard/matches. Powers the 'Matches for
// you' panel on /dashboard overview.
//
// Pipeline:
//   1. resolveVisibilityViewer once so private / SELECTED_COMPANIES /
//      MY_NETWORK rows never leak into the candidate set.
//   2. Build the candidate set from the caller's SAVED-SEARCH FILTERS (those
//      reflect /lots browsing intent) + the latest OPPOSITE-TYPE lots the
//      caller already posted (their own inventory for trade). Two intake
//      angles are deliberate — SAVED-SEARCHES capture WANTS, OWN LOTS capture
//      OFFERS.
//   3. Cap candidates (25/saved-search, 50 fallback) before scoring so the
//      LLM token spend stays bounded.
//   4. Batch-fetch profiles for poster userIds (handle isn't on the Lot row)
//      so the wire carries scrubbed poster identity without leaking third-
//      party data into anonymous listings.
//   5. Score via the installed `ai` module's `generateObject` helper. On
//      AIConfigurationError / any failure / unparseable output, fall back to
//      a local heuristic score using `closeInScope` + filter-hit bonus so the
//      panel still renders useful cards when the platform AI proxy isn't
//      available (dev fixtures, cold deploys, quota exhaustion).
//   6. Trim to top 5 and shape the DashboardMatches envelope.
//
// All failures degrade to the empty envelope — never 500 the dashboard.

import 'server-only';
import { NextResponse } from 'next/server';
import { generateObject } from '@/lib/ai/client';
import {
  bandsAreComparable,
  closeInScope,
  coarseContinentFor,
  gradesEquivalent,
  quantityBandLb,
} from '@/lib/business/comparable-matches';
import {
  ANONYMOUS_SCRUB,
  resolveViewerAccess,
  resolveVisibilityViewer,
} from '@/lib/business/lot-visibility';
import { DashboardMatches, type MatchItem } from '@/lib/contracts/dashboard-matches';
import { LotConditionEnum, PolymerEnum } from '@/lib/contracts/lots';
import { type LotFilter, LotFilter as LotFilterSchema } from '@/lib/contracts/lots-filters';
import { prisma } from '@/lib/db';
import { requireAuth, type SessionUser } from '@/lib/require-auth';

// Hard candidate caps so a noisy saved-search filter can't fan out into an
// unbounded LLM call.
const CANDIDATE_CAP_PER_SAVED_SEARCH = 25;
const FALLBACK_HEADROOM = 50;
const FINAL_MATCH_LIMIT = 5;

interface CandidateTrait {
  id: string;
  type: 'HAVE' | 'WANTED';
  polymer: string;
  condition: string;
  grade: string | null;
  manufacturer: string | null;
  quantityLb: string;
  country: string;
  location: string | null;
  visibility: string;
  postedByUserId: string | null;
  postedByName: string;
  postedByHandle: string | null;
  selectedCompanyIdentifiers: unknown;
  createdAt: string;
  matchedSavedSearchName: string | null;
}

function buildPrismaWhere(filter: LotFilter): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  // Honour a caller-set HARD type filter (`HAVE` or `WANTED`). `ALL`
  // narrows nothing here.
  if (filter.type === 'HAVE' || filter.type === 'WANTED') where.type = filter.type;
  if (filter.polymers.length > 0) where.polymer = { in: filter.polymers };
  if (filter.conditions.length > 0) where.condition = { in: filter.conditions };
  if (filter.form) where.form = { equals: filter.form, mode: 'insensitive' };
  if (filter.grade) where.grade = { contains: filter.grade, mode: 'insensitive' };
  if (filter.color) where.color = { contains: filter.color, mode: 'insensitive' };
  if (filter.q) {
    where.OR = [
      { notes: { contains: filter.q, mode: 'insensitive' } },
      { manufacturer: { contains: filter.q, mode: 'insensitive' } },
      { grade: { contains: filter.q, mode: 'insensitive' } },
      { color: { contains: filter.q, mode: 'insensitive' } },
    ];
  }
  if (filter.hasCoa !== null) where.hasCoa = filter.hasCoa;
  if (filter.quantityMin !== null || filter.quantityMax !== null) {
    const quantityRange: Record<string, number> = {};
    if (filter.quantityMin !== null) quantityRange.gte = filter.quantityMin;
    if (filter.quantityMax !== null) quantityRange.lte = filter.quantityMax;
    where.quantityLb = quantityRange;
  }
  if (filter.location) where.location = { contains: filter.location, mode: 'insensitive' };
  return where;
}

function readSavedSearchFilter(raw: unknown): LotFilter | null {
  try {
    return LotFilterSchema.parse(raw);
  } catch {
    return null;
  }
}

function buildReasonFromSignals(candidate: CandidateTrait): string {
  if (candidate.matchedSavedSearchName) {
    return `Matches your saved search: ${candidate.matchedSavedSearchName}`;
  }
  const bits: string[] = [];
  if (candidate.country) {
    const continent = coarseContinentFor(candidate.country, candidate.location);
    if (continent !== 'UNKNOWN') {
      bits.push(`Same region (${continent})`);
    }
  }
  if (candidate.grade) {
    bits.push(`${candidate.polymer} spec match`);
  } else {
    bits.push(`${candidate.polymer} family`);
  }
  return bits.length > 0 ? bits.join(' · ') : `${candidate.polymer} listing on the floor`;
}

function heuristicScore(candidate: CandidateTrait): number {
  let s = 0;
  if (candidate.matchedSavedSearchName) s += 0.4;
  if (candidate.country) {
    const c = coarseContinentFor(candidate.country, candidate.location);
    if (c !== 'UNKNOWN') s += 0.2;
  }
  if (candidate.grade && gradesEquivalent(candidate.grade, candidate.grade)) s += 0.25;
  const b = quantityBandLb(candidate.quantityLb);
  if (b > 0) s += 0.15;
  return Math.min(1, s);
}

function trimReason(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= 160) return collapsed;
  return `${collapsed.slice(0, 157)}…`;
}

// Lot row shape we SELECT — the minimum set we need for matching, scoring,
// and the wire. `postedByHandle` lives on Profile, looked up in a single
// batch pass after.
const lotSelect = {
  id: true,
  type: true,
  polymer: true,
  condition: true,
  grade: true,
  manufacturer: true,
  quantityLb: true,
  country: true,
  location: true,
  visibility: true,
  postedByUserId: true,
  postedByName: true,
  selectedCompanyIdentifiers: true,
  createdAt: true,
} as const;

type LotRowPicked = {
  id: string;
  type: 'HAVE' | 'WANTED';
  polymer: string;
  condition: string;
  grade: string | null;
  manufacturer: string | null;
  quantityLb: { toString(): string } | string | number;
  country: string;
  location: string | null;
  visibility: string;
  postedByUserId: string | null;
  postedByName: string;
  selectedCompanyIdentifiers: unknown;
  createdAt: Date;
};

function lotRowToCandidate(
  row: LotRowPicked,
  handleByUserId: Map<string, string | null>,
  matchedSavedSearchName: string | null,
): CandidateTrait {
  const handle =
    row.postedByUserId != null ? (handleByUserId.get(row.postedByUserId) ?? null) : null;
  return {
    id: row.id,
    type: row.type,
    polymer: row.polymer,
    condition: row.condition,
    grade: row.grade,
    manufacturer: row.manufacturer,
    quantityLb: typeof row.quantityLb === 'string' ? row.quantityLb : row.quantityLb.toString(),
    country: row.country,
    location: row.location,
    visibility: row.visibility,
    postedByUserId: row.postedByUserId,
    postedByName: row.postedByName,
    postedByHandle: handle,
    selectedCompanyIdentifiers: row.selectedCompanyIdentifiers,
    createdAt: row.createdAt.toISOString(),
    matchedSavedSearchName,
  };
}

export async function GET(req: Request) {
  let user: SessionUser;
  try {
    user = await requireAuth(req);
  } catch (res) {
    return res as Response;
  }

  try {
    const viewer = await resolveVisibilityViewer(user.id);

    const savedSearches = await prisma.savedSearch.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    const [ownHave, ownWanted] = await Promise.all([
      prisma.lot.findMany({
        where: { postedByUserId: user.id, type: 'HAVE' },
        orderBy: { createdAt: 'desc' },
        take: FALLBACK_HEADROOM,
        select: lotSelect,
      }),
      prisma.lot.count({ where: { postedByUserId: user.id, type: 'WANTED' } }),
    ]);

    const buyerHeavy = ownWanted > ownHave.length;
    const preferredCandidateType: 'HAVE' | 'WANTED' = buyerHeavy ? 'HAVE' : 'WANTED';

    const candidateMap = new Map<string, CandidateTrait>();

    // Saved-search filter intake.
    for (const row of savedSearches) {
      const filter = readSavedSearchFilter(row.filterJson);
      if (!filter) continue;
      const where = buildPrismaWhere(filter);
      try {
        const rows = await prisma.lot.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: CANDIDATE_CAP_PER_SAVED_SEARCH,
          select: lotSelect,
        });
        for (const lot of rows) {
          candidateMap.set(lot.id, lotRowToCandidate(lot, new Map(), row.name));
        }
      } catch {
        // One bad filter must not sink the panel.
      }
    }

    // Opposite-type fallback intake — buyerHeavy flips intent: a heavy buyer
    // wants HAVEs to bid on, a heavy seller wants WANTEDs that match their lot.
    const oppositeTypes: Array<'HAVE' | 'WANTED'> =
      ownHave.length === 0 && ownWanted === 0 ? ['HAVE', 'WANTED'] : [preferredCandidateType];

    const opposite = await prisma.lot.findMany({
      where: {
        type: { in: oppositeTypes },
        postedByUserId: { not: user.id },
        NOT: { id: { in: Array.from(candidateMap.keys()) } },
      },
      orderBy: { createdAt: 'desc' },
      take: FALLBACK_HEADROOM,
      select: lotSelect,
    });

    for (const lot of opposite) {
      candidateMap.set(lot.id, lotRowToCandidate(lot, new Map(), null));
    }

    // Single batched profile lookup so the candidate cast types narrow without
    // N+1 queries. Drops duplicate + null posters so it's also a cheap set.
    const posterIds = new Set<string>();
    for (const c of candidateMap.values()) {
      if (c.postedByUserId) posterIds.add(c.postedByUserId);
    }
    const profiles =
      posterIds.size > 0
        ? await prisma.profile.findMany({
            where: { userId: { in: Array.from(posterIds) } },
            select: { userId: true, handle: true },
          })
        : [];
    const handleByUserId = new Map<string, string | null>();
    for (const p of profiles) handleByUserId.set(p.userId, p.handle);

    // Repaint handle on candidates now that the profile batch is in memory.
    for (const c of candidateMap.values()) {
      if (c.postedByUserId != null) {
        c.postedByHandle = handleByUserId.get(c.postedByUserId) ?? null;
      }
    }

    const totalCandidates = candidateMap.size;

    // Visibility gate AFTER both intakes + profile lookup. resolveViewerAccess
    // returns the same row shape (visibility-bumped); cast back into our
    // CandidateTrait because we extended it with `matchedSavedSearchName`.
    const gated = resolveViewerAccess(
      Array.from(candidateMap.values()),
      viewer,
    ) as CandidateTrait[];

    if (gated.length === 0) {
      const empty = DashboardMatches.parse({
        matches: [],
        totalCandidates,
        fetchedAt: new Date().toISOString(),
      });
      return NextResponse.json(empty);
    }

    const ranked = await rankCandidates({ candidates: gated, ownHave, ownWanted });

    const matches: MatchItem[] = ranked
      .slice(0, FINAL_MATCH_LIMIT)
      .map((row) => toMatchItem(row.candidate, row.score, row.reason));

    const payload = DashboardMatches.parse({
      matches,
      totalCandidates,
      fetchedAt: new Date().toISOString(),
    });
    return NextResponse.json(payload);
  } catch {
    return NextResponse.json(
      DashboardMatches.parse({
        matches: [],
        totalCandidates: 0,
        fetchedAt: new Date().toISOString(),
      }),
    );
  }
}

interface RankedCandidate {
  candidate: CandidateTrait;
  score: number;
  reason: string;
}

async function rankCandidates({
  candidates,
  ownHave,
  ownWanted,
}: {
  candidates: CandidateTrait[];
  ownHave: Array<{
    polymer: string;
    grade: string | null;
    quantityLb: { toString(): string } | string | number;
    country: string;
    location: string | null;
  }>;
  ownWanted: number;
}): Promise<RankedCandidate[]> {
  // closeInScope wants ONE record per side — we pass the anchor fields
  // through directly without the full CandidateTrait wrapper.
  type Anchor = {
    polymer: string;
    grade: string | null;
    quantityLb: string;
    country: string;
    location: string | null;
  };
  const anchor: Anchor | null = ownHave[0]
    ? {
        polymer: ownHave[0].polymer,
        grade: ownHave[0].grade,
        quantityLb:
          typeof ownHave[0].quantityLb === 'string'
            ? ownHave[0].quantityLb
            : ownHave[0].quantityLb.toString(),
        country: ownHave[0].country,
        location: ownHave[0].location,
      }
    : null;

  const localScored = candidates.map((c) => ({
    candidate: c,
    score: localScore(c, anchor, ownWanted),
    reason: buildReasonFromSignals(c),
  }));

  let llmScores: Map<string, { score: number; reason: string }> | null = null;
  try {
    llmScores = await llmScoreCandidates(candidates, ownHave);
  } catch {
    llmScores = null;
  }

  const ranked: RankedCandidate[] = candidates.map((c, idx) => {
    const llm = llmScores?.get(c.id);
    const local = localScored[idx] ?? {
      candidate: c,
      score: heuristicScore(c),
      reason: buildReasonFromSignals(c),
    };
    if (!llm) {
      return { candidate: c, score: local.score, reason: local.reason };
    }
    // Blend: LLM lead score is the headline, with a local comparable bump
    // preserved to keep grade/continent signals even when the proxy is cold.
    const blended = Math.min(1, llm.score * 0.7 + local.score * 0.3);
    return {
      candidate: c,
      score: blended,
      reason: trimReason(llm.reason || local.reason),
    };
  });

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.candidate.id.localeCompare(b.candidate.id);
  });
  return ranked;
}

function localScore(
  candidate: CandidateTrait,
  anchor: {
    polymer: string;
    grade: string | null;
    quantityLb: string;
    country: string;
    location: string | null;
  } | null,
  ownWanted: number,
): number {
  let score = heuristicScore(candidate);
  if (anchor) {
    const comp = closeInScope(
      {
        polymer: anchor.polymer,
        grade: anchor.grade,
        quantityLb: anchor.quantityLb,
        country: anchor.country,
        location: anchor.location,
      },
      {
        polymer: candidate.polymer,
        grade: candidate.grade,
        quantityLb: candidate.quantityLb,
        country: candidate.country,
        location: candidate.location,
      },
    );
    score += Math.min(0.35, comp * 0.1);
    if (
      ownWanted > 0 &&
      bandsAreComparable(quantityBandLb(anchor.quantityLb), quantityBandLb(candidate.quantityLb))
    ) {
      score += 0.05;
    }
  }
  return Math.min(1, score);
}

async function llmScoreCandidates(
  candidates: CandidateTrait[],
  ownHave: Array<{
    polymer: string;
    grade: string | null;
    quantityLb: { toString(): string } | string | number;
    country: string;
  }>,
): Promise<Map<string, { score: number; reason: string }>> {
  const inventory = ownHave.slice(0, 5).map((row) => ({
    polymer: PolymerEnum.safeParse(row.polymer).success ? row.polymer : 'OTHER',
    grade: row.grade,
    quantityLb: typeof row.quantityLb === 'string' ? row.quantityLb : row.quantityLb.toString(),
    country: row.country,
  }));

  const compactCandidates = candidates.slice(0, 25).map((c) => ({
    id: c.id,
    type: c.type,
    polymer: PolymerEnum.safeParse(c.polymer).success ? c.polymer : 'OTHER',
    condition: LotConditionEnum.safeParse(c.condition).success ? c.condition : 'OTHER',
    grade: c.grade,
    quantityLb: c.quantityLb,
    country: c.country,
    matchedSavedSearchName: c.matchedSavedSearchName,
  }));

  const prompt = [
    'You are ranking candidate lots for a plastics-resin trading-floor user.',
    'Score each candidate 0..1 (1 = best fit) for how strongly it matches the',
    "caller's existing inventory and saved-search intent. Return STRICT JSON.",
    'Schema: {"items":[{"lotId":"<id>","score":<0..1>,"reason":"<=160 chars"}]}.',
    "Do not include lotIds that aren't listed below. Limit to top 10.",
    '',
    `Caller inventory: ${JSON.stringify(inventory)}`,
    `Candidates: ${JSON.stringify(compactCandidates)}`,
  ].join('\n');

  const parsed = await generateObject<{
    items: Array<{ lotId: string; score: number; reason: string }>;
  }>({
    messages: [{ role: 'user', content: prompt }],
    task: 'dashboard-matches',
    temperature: 0.2,
  });

  const out = new Map<string, { score: number; reason: string }>();
  if (!parsed?.items || !Array.isArray(parsed.items)) return out;
  for (const row of parsed.items) {
    if (!row || typeof row.lotId !== 'string' || typeof row.score !== 'number') continue;
    const score = Math.max(0, Math.min(1, row.score));
    out.set(row.lotId, {
      score,
      reason: typeof row.reason === 'string' ? row.reason : '',
    });
  }
  return out;
}

function toMatchItem(c: CandidateTrait, score: number, reason: string): MatchItem {
  // ANONYMOUS scrub at the wire boundary — same pattern as /api/lots so the
  // matches panel can never leak a private poster's identity.
  const scrubbed =
    c.visibility === 'ANONYMOUS'
      ? {
          postedByName: ANONYMOUS_SCRUB.postedByName,
          postedByHandle: ANONYMOUS_SCRUB.postedByHandle,
        }
      : { postedByName: c.postedByName, postedByHandle: c.postedByHandle };

  return {
    lotId: c.id,
    type: c.type,
    polymer: PolymerEnum.parse(c.polymer),
    condition: LotConditionEnum.parse(c.condition),
    grade: c.grade,
    quantityLb: c.quantityLb,
    manufacturer: c.manufacturer,
    country: c.country || 'Unknown',
    postedByName: scrubbed.postedByName,
    postedByHandle: scrubbed.postedByHandle,
    matchScore: Math.round(score * 1000) / 1000,
    reason: trimReason(reason),
    matchedSavedSearchName: c.matchedSavedSearchName,
  };
}
