// @polsia:user-owned — zod contracts for the new inventory bulk-upload
// workflow. Imported by the route handlers (server) AND the wizard
// client island (browser), so a shape change surfaces as a tsc /
// runtime parse error instead of silent drift. Mirrors the pattern in
// src/lib/contracts/lots.ts and src/lib/contracts/lots-bulk.ts.

import { z } from 'zod';
import {
  BULK_UPLOAD_CANONICAL_FIELDS,
  type CanonicalField,
} from '@/lib/business/inventory-bulk-upload/columns';

// `null` in the mapping = "ignore this column". We enumerate the
// canonical field names so a stray canonical (added later but not yet
// in the dropdown) doesn't sneak in via JSON.parse.
export const CanonicalFieldSchema = z.enum(
  BULK_UPLOAD_CANONICAL_FIELDS as unknown as readonly [CanonicalField, ...CanonicalField[]],
);

// HeaderMapping is `{ sourceHeader: canonical | null }`. Use a record
// of (string -> nullable canonical) so the client can serialize the
// seller's mapping for the commit round-trip.
export const HeaderMappingSchema = z.record(z.string(), CanonicalFieldSchema.nullable());

export type HeaderMappingWire = z.infer<typeof HeaderMappingSchema>;

// Per-row edits — the seller can override any of the cells the cell
// pipeline produced (e.g. fix a typo in `polymer`). Empty string
// removes the override; undefined keeps the source value.
export const RowEditsSchema = z.record(z.string(), z.string().optional());
export type RowEditsWire = z.infer<typeof RowEditsSchema>;

// Data returned by /preview for one row.
export const PreviewRowSchema = z.object({
  // 1-based row index the seller sees in Excel / Numbers.
  rowIndex: z.number().int().positive(),
  // Source values keyed by SPREADSHEET HEADER (not canonical) so the
  // preview table mirrors the source layout cell-for-cell.
  source: z.record(z.string(), z.string()),
  // Mapped values keyed by CANONICAL field — sheet row ALREADY passed
  // through the mapping + edits so the wizard renders "what we'd
  // actually commit".
  values: z.record(z.string(), z.string()),
  ok: z.boolean(),
  errors: z.array(z.object({ field: z.string(), message: z.string() })),
  // Resin-normalised values the server would persist for this row
  // (canonical polymer + canonical grade + resolved color). Sourced
  // from the shared resin-normalize helper; surfaces on the preview
  // table so the seller sees "Resolved as: PC" next to the row before
  // committing. `null` for non-resin fields stays so the wizard can
  // tell apart "no input" from "resolved to null".
  normalized: z.object({
    polymer: z.string(),
    grade: z.string().nullable(),
    color: z.string().nullable(),
  }),
});
export type PreviewRow = z.infer<typeof PreviewRowSchema>;

export const PreviewResponseSchema = z.object({
  summary: z.object({
    total: z.number().int().nonnegative(),
    valid: z.number().int().nonnegative(),
    errored: z.number().int().nonnegative(),
  }),
  // Auto-recognised mapping echoed back so the wizard does not need
  // to round-trip its initial guess.
  mapping: HeaderMappingSchema,
  // Any header that didn't auto-match — surfaced in the wizard's
  // mapping card so the seller can confirm or ignore.
  ambiguous: z.array(z.string()),
  // Parsed rows (in input order), one PreviewRow per data sheet row.
  rows: z.array(PreviewRowSchema),
});
export type PreviewResponse = z.infer<typeof PreviewResponseSchema>;

// `CommitRequest` is JSON-only — the spreadsheet lives in a separate
// `multipart/form-data` body whose `file` part is re-parsed on the
// server. The mapping + per-row edits travel in the JSON half.
export const CommitRequestSchema = z.object({
  mapping: HeaderMappingSchema,
  // One edits entry per PreviewRow.key, mapped from `rowIndex`. Keys
  // are strings so JSON stays flat; values are optional per-field
  // overrides.
  edits: z.record(z.string(), RowEditsSchema),
});
export type CommitRequest = z.infer<typeof CommitRequestSchema>;

// Skip reasons returned by /commit — one per rejected row, with the
// short reason string that the wizard renders under the row badge.
export const CommitSkippedSchema = z.object({
  rowIndex: z.number().int().positive(),
  // First-message-only summary so the wizard keeps a compact list.
  message: z.string(),
  errors: z.array(z.object({ field: z.string(), message: z.string() })),
});
export type CommitSkipped = z.infer<typeof CommitSkippedSchema>;

export const CommitResponseSchema = z.object({
  imported: z.array(z.object({ rowIndex: z.number().int().positive(), lotId: z.string() })),
  skipped: z.array(CommitSkippedSchema),
});
export type CommitResponse = z.infer<typeof CommitResponseSchema>;
