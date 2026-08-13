// @polsia:user-owned — shared zod contract for the transaction-rating
// resource. Imported by the /api/ratings* route handlers (server) AND the
// client islands (client); keeps form ↔ API shape in lockstep so server
// validation errors can flow onto form fields via applyServerErrors.
//
// The dimensions mirror the `RatingDimension` enum in
// prisma/schema/rating.prisma verbatim (the string literals cross-reference
// the same set) — keeping the contract the single source of truth for
// which dimensions are rateable prevents the enum and the UI from drifting.
import { z } from 'zod';

export const RatingDimensionEnum = z.enum([
  'MATERIAL_MATCH',
  'DOCUMENTATION',
  'PAYMENT',
  'SHIPPING',
  'COMMUNICATION',
]);
export type RatingDimension = z.infer<typeof RatingDimensionEnum>;

// One dimension row in a submit form. Score is 1–5 (int); comment is an
// optional free-text blurb (capped so a chatty rater can't push 5KB into the
// aggregate endpoint).
export const RatingScoreInput = z.object({
  dimension: RatingDimensionEnum,
  score: z.number().int().min(1, 'Score must be 1–5').max(5, 'Score must be 1–5'),
  comment: z.string().max(500, 'Comment is too long').optional().nullable(),
});
export type RatingScoreInput = z.infer<typeof RatingScoreInput>;

// POST /api/ratings body. EXACTLY five rows (one per dimension); the form
// refuses a Submit click until all five have a score.
export const SubmitRating = z.object({
  threadId: z.string().min(1),
  scores: z.array(RatingScoreInput).length(5, 'Score all 5 dimensions'),
});
export type SubmitRatingInput = z.infer<typeof SubmitRating>;

// What a participant sees on a thread: the thread's status, the partner's
// userId (null for broker-group rooms), and which dimensions the caller
// has already submitted. Powers the form-vs-confirmation rendering in
// <Thread/> and the rate vs re-rate toggle in the confirmation state.
export const RatingStatus = z.object({
  threadStatus: z.enum(['PENDING', 'COMPLETED', 'CANCELED']),
  counterpartUserId: z.string().nullable(),
  ratedDimensions: z.array(RatingDimensionEnum),
});
export type RatingStatus = z.infer<typeof RatingStatus>;

// GET /api/ratings/aggregate/[userId] — per-dimension avg + count over every
// rating the user has received. Only dimensions with at least one rating
// appear on the wire (a missing dimension means "no ratings yet" — the
// profile card renders the row in a muted state rather than a hard 0).
export const RatingAggregate = z.record(
  RatingDimensionEnum,
  z.object({
    avg: z.number(),
    count: z.number().int().nonnegative(),
  }),
);
export type RatingAggregate = z.infer<typeof RatingAggregate>;

// Server-side persisted record returned by POST /api/ratings. The list is
// the five rows in insertion order; only the client form keeps a parallel
// view of the in-flight draft.
export const RatingItem = z.object({
  id: z.string(),
  threadId: z.string(),
  raterId: z.string(),
  rateeId: z.string(),
  dimension: RatingDimensionEnum,
  score: z.number().int().min(1).max(5),
  comment: z.string().nullable(),
  createdAt: z.string(),
});
export type RatingItem = z.infer<typeof RatingItem>;

export const RatingList = z.object({ items: z.array(RatingItem) });
export type RatingList = z.infer<typeof RatingList>;

// PATCH /api/threads/[threadId]/status body — caller chooses between
// COMPLETED (closes the deal) or CANCELED (aborts without rating). Other
// transitions are rejected at the route.
export const UpdateTransactionStatus = z.object({
  status: z.enum(['COMPLETED', 'CANCELED']),
});
export type UpdateTransactionStatusInput = z.infer<typeof UpdateTransactionStatus>;

// Thread status enum mirrors prisma/schema/messaging.prisma's
// TransactionStatus; surfaces to clients as the same string set.
export const TransactionStatusEnum = z.enum(['PENDING', 'COMPLETED', 'CANCELED']);
export type TransactionStatus = z.infer<typeof TransactionStatusEnum>;
