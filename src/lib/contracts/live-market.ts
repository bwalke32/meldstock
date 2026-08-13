// @polsia:user-owned — shared zod contract for the /dashboard "Live market"
// panel. Imported by /api/dashboard/live-market (server) AND the
// LiveMarketPanel client island (client) so route + island parse the same
// shape and any drift fails at runtime, not silently in typed UI code.
//
// Shape is intentionally narrow — a marketplace-wide teaser, not a personal
// feed. The handler runs the visibility gate upstream so a private lot never
// leaks into this snippet, but the wire shape itself contains no seller
// identity (matches the ANONYMOUS scrubbed feel even for visible rows).

import { z } from 'zod';
import { LotConditionEnum, LotTypeEnum, type Polymer, PolymerEnum } from '@/lib/contracts/lots';

// One row from the "Recently posted" list. Server-side already formats
// quantityLb in its raw string form (Prisma Decimal → string); the island
// parses it client-side for display only.
export const RecentItem = z.object({
  id: z.string(),
  polymer: PolymerEnum,
  // Grade is free-form text in the schema (manufacturer spec); may be null.
  grade: z.string().nullable(),
  quantityLb: z.string(),
  createdAt: z.string(),
  type: LotTypeEnum,
  condition: LotConditionEnum,
  color: z.string(),
  form: z.string(),
  manufacturer: z.string().nullable(),
});
export type RecentItem = z.infer<typeof RecentItem>;

// One row from the "Top polymers (7 days)" list.
export const TopPolymerRow = z.object({
  polymer: PolymerEnum,
  count: z.number().int().nonnegative(),
});
export type TopPolymerRow = z.infer<typeof TopPolymerRow>;

// GET /api/dashboard/live-market response envelope.
export const LiveMarketSnapshot = z.object({
  recent: z.array(RecentItem).max(5),
  topPolymers: z.array(TopPolymerRow).max(3),
  fetchedAt: z.string(),
});
export type LiveMarketSnapshot = z.infer<typeof LiveMarketSnapshot>;

// Re-exports so the client island can label Polymer values without pulling
// the (heavier) contracts/lots module into its bundle.
export type { Polymer };
