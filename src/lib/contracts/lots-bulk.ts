// @polsia:user-owned — zod contract for POST /api/lots/bulk. Mirrors the
// pattern in src/lib/contracts/lots.ts: imported by the route handler (server,
// for typing) AND by the upload island (client, via apiFetch's `schema`
// parameter so the response is parsed + validated rather than unchecked-cast).
import { z } from 'zod';

export const BulkLotsRequest = z.object({
  // Raw CSV text — kept on the wire as-is so the client can paste or upload
  // a `.csv` file without re-encoding. The server applies an explicit
  // ≤1 MB body cap + a row-cap (≤500) before parsing; a payload larger than
  // either cap surfaces as a 413 so the island can show a friendly error.
  csv: z.string().min(1, 'CSV is empty'),
});
export type BulkLotsRequest = z.infer<typeof BulkLotsRequest>;

export const BulkLotsResult = z.object({
  // 1-based row index (CSV row position after the header). Matches the row
  // number a seller sees in Excel/Numbers so they can locate the problem.
  rowIndex: z.number().int().positive(),
  status: z.enum(['created', 'error']),
  // On create: short identifier ("created: <id>"). On error: column-scoped
  // reason ("grade: is required"). Avoids two different shapes in the array.
  message: z.string(),
  lotId: z.string().optional(),
});
export type BulkLotsResult = z.infer<typeof BulkLotsResult>;

export const BulkLotsResponse = z.object({
  summary: z.object({
    total: z.number().int().nonnegative(),
    created: z.number().int().nonnegative(),
    errored: z.number().int().nonnegative(),
  }),
  // Per-row outcomes in INPUT order (the seller sees the same row order they
  // pasted). Persisted-row IDs are returned here so the UI can deep-link to
  // a successfully created lot without a second round-trip.
  results: z.array(BulkLotsResult),
});
export type BulkLotsResponse = z.infer<typeof BulkLotsResponse>;
