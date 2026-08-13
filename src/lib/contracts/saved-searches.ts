// @polsia:user-owned — shared zod contract for the saved-searches resource.
// Imported by /api/saved-searches/* (server) AND the saved-searches client
// islands. The wire shape is defined ONCE here so the route handler, the
// browse sidebar, and the dashboard overview can't disagree.
//
// `SavedSearchFilter` is INTERNAL — the wire shape is `LotFilter` from
// @/lib/contracts/lots-filters (the same one /api/lots parses). That keeps a
// single filter source of truth; the saved-search row just stores
// `filterJson: LotFilter` and the GET handler asks the server for a live
// `matchCount` by re-applying that filter against the lot table.

import { z } from 'zod';
import type { LotFilter as LotFilterType } from '@/lib/contracts/lots-filters';
import { LotFilter } from '@/lib/contracts/lots-filters';

// Wire shape returned by GET /api/saved-searches. Server attaches a live
// `matchCount` re-evaluated at read time — see /api/saved-searches#GET.
export const SavedSearch = z.object({
  id: z.string(),
  name: z.string(),
  filter: LotFilter,
  matchCount: z.number().int().nonnegative(),
  alertEnabled: z.boolean(),
  lastAlertSentAt: z.string().nullable(),
  createdAt: z.string(),
});
export type SavedSearch = z.infer<typeof SavedSearch>;

export const SavedSearchList = z.object({ items: z.array(SavedSearch) });
export type SavedSearchList = z.infer<typeof SavedSearchList>;

// POST body — client never supplies id / matchCount / createdAt.
export const SavedSearchCreate = z.object({
  name: z.string().min(1, 'Name is required').max(80),
  filter: LotFilter,
});
export type SavedSearchCreate = z.infer<typeof SavedSearchCreate>;

// PATCH body for in-place edits (name and/or filter and/or alertEnabled).
// ALL optional so a single PATCH can flip the toggle, rename, or rewrite the
// filter independently. Server applies { id, userId } scoping — see
// /api/saved-searches/[id]#PATCH.
export const SavedSearchUpdate = z.object({
  name: z.string().min(1, 'Name is required').max(80).optional(),
  filter: LotFilter.optional(),
  alertEnabled: z.boolean().optional(),
});
export type SavedSearchUpdate = z.infer<typeof SavedSearchUpdate>;

// Parse a stored filterJson blob back to a LotFilter. The DB stores whatever
// the client posted (a LotFilter.parse(…) result); round-tripping through
// LotFilter.parse validates shapes against the current contract so a future
// schema change can't break the fan-out silently.
export function parseSavedSearchFilter(raw: unknown): LotFilterType {
  return LotFilter.parse(raw);
}
