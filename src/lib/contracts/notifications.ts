// @polsia:user-owned — zod wire contract for the in-app notification inbox.
//
// Returned by GET /api/notifications and GET /api/notifications/unread-count.
// Consumed by the notifications list island and the unread-badge hook via
// `apiFetch(..., { schema })`. Shape design notes:
//
//   - `payload` is `z.unknown()` server-side because the shape varies by
//     `kind` (saved-search match carries a lot id + saved-search names +
//     filter; thread message carries a thread id + sender name + isRfqReply).
//     The client island discriminates by `kind` and narrows in-component.
//   - Dates are ISO strings on the wire (matches the messaging unread
//     contract — keeps client/server parsing identical).
//   - `list` is cursor-paged (cursor = the oldest id in the current page)
//     to keep the GET handler a single round-trip per page and the inbox
//     scroll cheap even with hundreds of unread rows.
import { z } from 'zod';

export const NotificationKind = z.enum(['SAVED_SEARCH_MATCH', 'THREAD_MESSAGE']);
export type NotificationKind = z.infer<typeof NotificationKind>;

export const NotificationItem = z.object({
  id: z.string(),
  kind: NotificationKind,
  payload: z.unknown(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});
export type NotificationItem = z.infer<typeof NotificationItem>;

export const NotificationList = z.object({
  items: z.array(NotificationItem),
  // Echoed cursor so the client can request the next page. Null when the
  // current page was the last one.
  nextCursor: z.string().nullable(),
});
export type NotificationList = z.infer<typeof NotificationList>;

export const UnreadCount = z.object({
  count: z.number().int().nonnegative(),
});
export type UnreadCount = z.infer<typeof UnreadCount>;
