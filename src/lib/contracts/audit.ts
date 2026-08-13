// @polsia:user-owned — zod enum / shape helpers for the audit log.
// Used at the recorder call sites so any typo in the action string
// fails safe (a 422 at build time, not a memo'd unstoppable action).
// The `recordAudit` helper in @/lib/security/audit does NOT enforce the
// enum at runtime — it accepts the same union for safety, but the
// route handler always passes the typed literal so a refactor that
// drops an action is caught by `tsc`.
import { z } from 'zod';

export const AuditAction = z.enum([
  // Deal-stepper / closeout transitions (audit per advance + final flip).
  'OFFER_ACCEPTED',
  'DEAL_ADVANCED',
  'DEAL_COMPLETED',
  'DEAL_CANCELED',
  // Structured offer / counter-offer lifecycle (HAVE listings).
  'OFFER_CREATED',
  'OFFER_COUNTERED',
  'OFFER_DECLINED',
  'OFFER_WITHDRAWN',
  // Structured seller-response / counter lifecycle (WANTED/RFQ listings).
  'WANTED_RESPONSE_CREATED',
  'WANTED_RESPONSE_COUNTERED',
  'WANTED_RESPONSE_ACCEPTED',
  'WANTED_RESPONSE_DECLINED',
  'WANTED_RESPONSE_WITHDRAWN',
  // Lot visibility change via /api/lots/[id] PATCH (broker controls visibility).
  'LOT_VISIBILITY_CHANGED',
  // Document lifecycle — upload + access (per-document access log).
  'LOT_DOCUMENT_DOWNLOADED',
  'LOT_DOCUMENT_UPLOADED',
  // Per-lot anonymous message POST — sender is not authenticated.
  'LOT_MESSAGE_POSTED',
  // Thread message fan-out when senderName is masked (ANONYMOUS-lot thread).
  'SENSITIVE_THREAD_MESSAGE_FANNED_OUT',
  // Verification request creation — PII-adjacent (carries free-text support).
  'VERIFICATION_REQUEST_CREATED',
  // 429 from a rate-limited route — observable signal of suspicious traffic.
  'RATE_LIMITED',
  // Inventory lifecycle (owner-facing refresh/mark-sold/deactivate/confirm).
  'LOT_REFRESHED',
  'LOT_MARKED_SOLD',
  'LOT_DEACTIVATED',
  'LOT_CONFIRMED_AVAILABLE',
  'LOT_RELISTED',
  // Bulk lifecycle fan-out skipped rows (bulk endpoint emits one per skip).
  'LOT_BULK_SKIPPED',
]);
export type AuditAction = z.infer<typeof AuditAction>;

export const AuditActor = z.enum(['USER', 'ADMIN', 'SYSTEM']);
export type AuditActor = z.infer<typeof AuditActor>;
