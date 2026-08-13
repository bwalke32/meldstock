// @polsia:user-owned — shared zod contract for the 'Matches for you' panel
// on /dashboard. Imported by /api/dashboard/matches (server) AND
// src/components/custom/dashboard/matches-panel (client) so route + island
// parse the same shape; any drift fails at runtime, not silently in typed UI.
//
// The shape is intentionally narrow: enough metadata for a spec-sheet card +
// a one-line reason + a 0..1 score so the client can rank-order the row
// visually. The matchedSavedSearchName provenance field is for the empty-state
// CTA, NOT for matching.
import { z } from 'zod';
import { LotConditionEnum, LotTypeEnum, PolymerEnum } from '@/lib/contracts/lots';

export const MatchItem = z.object({
  lotId: z.string(),
  type: LotTypeEnum,
  polymer: PolymerEnum,
  condition: LotConditionEnum,
  grade: z.string().nullable(),
  quantityLb: z.string(),
  manufacturer: z.string().nullable(),
  country: z.string(),
  postedByName: z.string(),
  postedByHandle: z.string().nullable(),
  matchScore: z.number().min(0).max(1),
  // One-line, capped server-side to keep card caption width predictable.
  reason: z.string().min(1).max(160),
  // Provenance — what saved-search the LLM matched against (or null when the
  // match came from a manual score over the caller's primary inventory). Used
  // only to point the user back to a real saved search; never matched on.
  matchedSavedSearchName: z.string().nullable(),
});
export type MatchItem = z.infer<typeof MatchItem>;

export const DashboardMatches = z.object({
  matches: z.array(MatchItem).max(5),
  // Sized so the empty-state copy can say "we scored X candidates against N
  // saved searches" before the LLM trimmed them to top 5.
  totalCandidates: z.number().int().nonnegative(),
  fetchedAt: z.string(),
});
export type DashboardMatches = z.infer<typeof DashboardMatches>;
