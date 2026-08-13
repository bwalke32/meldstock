// @polsia:user-owned — shared zod contracts for the lot-lifecycle endpoints
// (refresh / mark-sold / deactivate / confirm-available / bulk-lifecycle /
// stale). Used by both the API route handlers AND the client islands so
// form ↔ API shape stays in lockstep.

import { z } from 'zod';

// --- PATCH /api/lots/[id] body (extended from visibility-only). Owner can
//     update the `quantityRemaining` (e.g. after a partial deal closes)
//     and bump `lastUpdatedAt` with `refresh: true` instead of firing the
//     dedicated POST refresh endpoint.
export const PatchMyLot = z
  .object({
    // Either field is optional — sending both is fine. 0 ≤ remaining ≤
    // quantityLb; the route handler clamps to that range so a 5kg request
    // can never publish more than the lot's total weight.
    quantityRemaining: z
      .number()
      .min(0, 'Quantity remaining cannot be negative')
      .optional()
      .nullable(),
    // If `true`, bump `lastUpdatedAt` + clear `lastNudgedAt` so this lot
    // drops out of the stale-banner list. Mirrors POST /api/lots/[id]/refresh.
    refresh: z.boolean().optional(),
    // Pre-existing visibility writes — pass through the existing source
    // contract so the PATCH stays backward compatible. visibility + identifier
    // editing is unchanged.
    visibility: z
      .enum(['PUBLIC', 'VERIFIED_COMPANIES_ONLY', 'MY_NETWORK', 'SELECTED_COMPANIES', 'ANONYMOUS'])
      .optional(),
    selectedCompanyIdentifiers: z.array(z.string().min(1).max(120)).max(50).optional(),
  })
  .strict();

export type PatchMyLot = z.infer<typeof PatchMyLot>;

// --- POST /api/lots/[id]/mark-sold — empty body. The UI fires the request
//     on click; the server returns 204 because no body is meaningful.
export const MarkSoldBody = z.object({}).strict();
export type MarkSoldBody = z.infer<typeof MarkSoldBody>;

// --- POST /api/lots/[id]/deactivate — empty body.
export const DeactivateBody = z.object({}).strict();
export type DeactivateBody = z.infer<typeof DeactivateBody>;

// --- POST /api/lots/[id]/confirm-available — empty body. Server stamps
//     `lastConfirmedAt = now` + bumps `lastUpdatedAt` + flips
//     EXPIRED → ACTIVE if applicable.
export const ConfirmStillAvailableBody = z.object({}).strict();
export type ConfirmStillAvailableBody = z.infer<typeof ConfirmStillAvailableBody>;

// --- POST /api/lots/[id]/refresh — empty body. Bumps `lastUpdatedAt`,
//     clears `lastNudgedAt`. Returns 204.
export const RefreshLotBody = z.object({}).strict();
export type RefreshLotBody = z.infer<typeof RefreshLotBody>;

// --- POST /api/lots/bulk-lifecycle — apply one action across lots. Body
//     lists lot ids + the action to fan out across them. The route returns
//     a `{ updated, skipped: [{ id, reason }] }` summary. `action` is the
//     same set the per-lot endpoints accept — the bulk handler is a pure
//     fan-out, no new semantics.
export const BulkLotsActionEnum = z.enum(['refresh', 'deactivate', 'markSold']);
export type BulkLotsAction = z.infer<typeof BulkLotsActionEnum>;

export const BulkLotsActionBody = z
  .object({
    ids: z
      .array(z.string().min(1))
      .min(1, 'Pick at least one lot')
      .max(200, 'No more than 200 ids'),
    action: BulkLotsActionEnum,
  })
  .strict();

export type BulkLotsActionBody = z.infer<typeof BulkLotsActionBody>;

// --- GET /api/lots/stale response shape. Wraps the same `LotItem` used by
//     the rest of the trading-floor resource so client islands can reuse
//     the existing parser.
export const StaleLotsResponse = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      lastUpdatedAt: z.string(),
      lastNudgedAt: z.string().nullable(),
      staleness: z.enum(['fresh', 'nudge', 'expire']),
    }),
  ),
});

export type StaleLotsResponse = z.infer<typeof StaleLotsResponse>;

// --- Bulk response — `{ updated, skipped: [{ id, reason }] }`. Each
//     reason is a short string the UI can render as a per-row toast;
//     longer diagnostic text is intentionally not carried over the wire.
export const BulkLotsActionResponse = z.object({
  updated: z.number().int().min(0),
  skipped: z.array(z.object({ id: z.string(), reason: z.string() })),
});

export type BulkLotsActionResponse = z.infer<typeof BulkLotsActionResponse>;
