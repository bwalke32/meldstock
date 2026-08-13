// @polsia:user-owned — zod wire contract for the /dashboard unread widget.
//
// Returned by GET /api/messages/unread and consumed by the dashboard card via
// `apiFetch(..., { schema })`. Shape design notes:
//   - `unreadCount` is a TOTAL across every thread the caller participates in
//     (as buyer OR seller). This is what shows in the card's big-number.
//   - `recent` is a teaser list — TOP 3 threads ordered by activity. The card
//     shows these rows directly; the inbox page (`/messages`) is the
//     exhaustive view reached via the "View inbox →" CTA in the action slot.
//   - `lastMessageBody` is a preview, NOT the full message — both server and
//     client truncate consistently.
import { z } from 'zod';

// RFQ preview stamped on a WANTED-origin thread row. Slimmer than the
// ThreadItem `RfqContext` — no back-link target (the dashboard widget
// reads `threadId` for its action) but carries the same three identifiers
// so the widget can render the "RFQ: <grade>/<qty>/<loc>" pill.
export const RfqPreview = z.object({
  grade: z.string().nullable(),
  quantityLb: z.string(),
  location: z.string().nullable(),
});
export type RfqPreview = z.infer<typeof RfqPreview>;

export const UnreadThreadPreview = z.object({
  threadId: z.string(),
  // Nullable so broker-group rooms (which have no lot) flow through the
  // same wire shape — the dashboard card renders "Broker room" in place
  // of the lot title when this is null.
  lotId: z.string().nullable(),
  // Human label for the lot backing this thread (NOT the persisted
  // `subject` — we re-derive from the live `lotSummary` so renames/edits
  // reflect on the dashboard immediately). For broker-group rooms, this
  // falls back to "Broker room".
  lotTitle: z.string(),
  // Counterparty display name (the other participant on the thread).
  otherPartyName: z.string(),
  lastMessageBody: z.string(),
  lastMessageAt: z.string(),
  // RFQ preview — non-null iff this thread is WANTED-origin. The card
  // swaps this in for `lotTitle` so an inbox newcomer can see "this thread
  // is about THAT RFQ" at a glance.
  rfq: RfqPreview.nullable(),
});
export type UnreadThreadPreview = z.infer<typeof UnreadThreadPreview>;

export const UnreadSummary = z.object({
  unreadCount: z.number().int().nonnegative(),
  recent: z.array(UnreadThreadPreview).max(3),
});
export type UnreadSummary = z.infer<typeof UnreadSummary>;
