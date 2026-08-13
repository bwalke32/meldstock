// @polsia:user-owned — shared zod contract for the messaging resource:
// listing-scoped (1:1 + N-way) threads AND broker-group rooms (NOT tied to
// a single lot). Imported by the route handlers (server) AND the client
// islands (client); keeps form ↔ API shape in lockstep so server
// validation can flow onto form fields (see applyServerErrors in
// src/lib/forms.ts).
import { z } from 'zod';

// --- A single message in a thread. --------------------------------------
// `attachmentUrl` on the wire is an OPAQUE relative API path
// (`/api/threads/<threadId>/attachments/<msgId>/download`). The raw CDN
// URL is never exposed — the download proxy re-checks thread
// participation before streaming bytes.
export const MessageItem = z.object({
  id: z.string(),
  threadId: z.string(),
  senderId: z.string(),
  body: z.string(),
  createdAt: z.string(),
  attachmentUrl: z.string().nullable().optional(),
  attachmentFilename: z.string().nullable().optional(),
  attachmentMimeType: z.string().nullable().optional(),
  attachmentBytes: z.number().int().nonnegative().optional(),
});
export type MessageItem = z.infer<typeof MessageItem>;

// --- The wire shape used by the inbox + thread page header ---------------
// `ThreadItem.subject` is the lot summary at thread create time — it doubles
// as a stable human label. `lotSummary` is the same string refreshed from
// the live lot so a thread on an updated lot reflects current specs.
export const LotSummary = z.object({
  id: z.string(),
  polymer: z.string(),
  condition: z.string(),
  form: z.string(),
  color: z.string(),
  manufacturer: z.string().nullable(),
  grade: z.string().nullable(),
  quantityLb: z.string(),
});
export type LotSummary = z.infer<typeof LotSummary>;

// RFQ context stamped on a thread when the source lot was WANTED. The lot id
// IS the RFQ id — the UI renders "RFQ: <grade>/<quantityLb>/<location>" so
// a buyer can spot which negotiation an inbox row stands for, and links
// back to `/lots/<id>` to revisit the original WANTED listing.
//
// `id` mirrors `lot.id` (the lot IS the RFQ) so legacy code can pass the
// top-level field through without re-reading `lot`, and `lot.id` is the
// canonical link target for the back-link.
export const RfqContext = z.object({
  id: z.string(),
  lot: z.object({
    id: z.string(),
    grade: z.string().nullable(),
    quantityLb: z.string(),
    location: z.string().nullable(),
  }),
});
export type RfqContext = z.infer<typeof RfqContext>;

export const OtherParty = z.object({
  userId: z.string(),
  displayName: z.string(),
  companyName: z.string().nullable(),
  handle: z.string().nullable(),
  // Stamped by /api/threads from the same profile lookup as the rest of
  // the row — true iff the counterparty's role is BROKER_TRADER. Drives
  // the broker-profile link from the thread header. Required on the
  // wire because every hydrating path now populates the profile `role`
  // select; both list and detail handlers were updated atomically with
  // this field.
  counterpartyIsBroker: z.boolean(),
});
export type OtherParty = z.infer<typeof OtherParty>;

// Per-thread discriminator. Drives the inbox row badge and the right-pane
// header — listing/RFQ threads render "With <otherParty> · re: <lot>";
// broker-group rooms render the room name + description + member count.
export const ThreadKind = z.enum(['LISTING', 'RFQ', 'BROKER_GROUP']);
export type ThreadKind = z.infer<typeof ThreadKind>;

// Per-user participant row on a thread. Forward-declared above
// `ThreadItem` so the inbox row can carry a top-3 members array as part
// of its wire (no second fetch, no client-side fan-out).
export const ParticipantItem = z.object({
  userId: z.string(),
  displayName: z.string(),
  companyName: z.string().nullable(),
  handle: z.string().nullable(),
  addedAt: z.string(),
  addedByDisplayName: z.string().nullable().optional(),
});
export type ParticipantItem = z.infer<typeof ParticipantItem>;
// Aliased re-export so client islands can `import { ParticipantItemSchema }`
// and pass it to `apiFetch(..., { schema })` without the type-name shadowing
// the value — imports the same the route does.
export const ParticipantItemSchema = ParticipantItem;

export const ThreadItem = z.object({
  id: z.string(),
  // Nullable end-to-end: broker-group rooms are not tied to any lot. NULL
  // legacy rows cannot exist (the schema is in `db push` from LISTING-defaulted
  // state), but the wire is permissive so the UI can short-circuit cleanly.
  lotId: z.string().nullable(),
  lotSummary: LotSummary.nullable(),
  // Nullable: broker-group rooms have no buyer/seller pair. Legacy 1:1 rows
  // always populate both.
  buyerId: z.string().nullable(),
  sellerId: z.string().nullable(),
  // `otherParty` is only meaningful on a listing/RFQ thread (has a
  // counterparty). For broker-group rooms it must be `null` (the UI falls
  // back to the room name + member avatars).
  otherParty: OtherParty.nullable(),
  subject: z.string(),
  // Free-text room description. Only populated for broker-group rooms;
  // null for listing/RFQ threads.
  description: z.string().nullable().optional(),
  createdAt: z.string(),
  lastMessageAt: z.string(),
  lastMessage: MessageItem.nullable(),
  // Per-thread unread flag, derived server-side from the same rule used by
  // /api/messages/unread: latest message sender !== currentUser.id AND
  // (no `ThreadReadState` cursor OR `latest.createdAt > cursor`). Stamped on
  // every hydrated list item so the inbox list renders the badge without
  // per-thread polling.
  unread: z.boolean(),
  // Total participants on this thread (creator + any later additions for
  // rooms; buyer + seller + add-ons for listing threads). Server-resolved
  // from `ThreadParticipant`. Kept as a single int, not the full roster,
  // so the list endpoint stays O(1) per row.
  participantCount: z.number().int().nonnegative(),
  // RFQ context — non-null iff this thread was created on a WANTED lot. Stamped
  // by the API when `MessageThread.rfqId` is set; rendered by the inbox rows
  // and the thread header as the distinctive "RFQ: <grade>/<qty>/<loc>" pill.
  rfq: RfqContext.nullable(),
  // Discriminator: broker-group rooms vs listing/RFQ threads. Stamped on
  // every row.
  kind: ThreadKind,
  // Top-3 member participant items stamped on rooms so the inbox row can
  // render the avatar stack without a second fetch. `null` for listing
  // threads; for broker-group rooms, length is at most 3 and equals
  // `participantCount` when count ≤ 3.
  members: z.array(ParticipantItem).nullable().optional(),
  // Display name of the room creator (or, for listing threads, null).
  // Stamped only on broker-group threads.
  createdByDisplayName: z.string().nullable().optional(),
  // User id of the room creator — null for listing/RFQ threads (and
  // .optional() so legacy callers without the field still parse).
  createdByUserId: z.string().nullable().optional(),
  // Stamped alongside `createdByUserId` — true iff the creator's role
  // is BROKER_TRADER. Drives the broker-profile link in the room header.
  createdByIsBroker: z.boolean().optional(),
  // Lifecycle state of the underlying deal — the "Mark as completed" pill +
  // the post-completion rating card both branch on this without a second
  // fetch. Always PENDING for broker-group rooms (no buyer/seller pair).
  threadStatus: z.enum(['PENDING', 'COMPLETED', 'CANCELED']).optional(),
  // ISO timestamp of the COMPLETED transition (or null while PENDING/
  // CANCELED). Stamped only on the wire when non-null.
  completedAt: z.string().nullable().optional(),
  // Front-of-the-pipeline deal stepper position. Distinct from
  // `threadStatus` (the closeout lifetime): same thread can be
  // `dealStatus = COMPLETED` while the operational closeout is still
  // PENDING. Defaults to OFFER; broker-group rooms also stamp OFFER but
  // the UI hides the strip on those rooms (matches the closeout pill's
  // branch on `isRoom`).
  dealStatus: z
    .enum([
      'OFFER',
      'ACCEPTED',
      'PO_ISSUED',
      'PICKUP_SCHEDULED',
      'IN_TRANSIT',
      'DELIVERED',
      'COMPLETED',
    ])
    .optional(),
  // ISO timestamp of the last advance, or null on a fresh OFFER thread.
  // Powers "advanced N ago" copy on the header. Omitted on broker-group
  // rooms because the stepper is suppressed there.
  dealStatusUpdatedAt: z.string().nullable().optional(),
  // Server-stamped permission: true iff the caller can PATCH this thread's
  // stepper. Concretely the caller is the thread's seller OR the caller
  // is a platform admin. Always false on broker-group rooms. Drives the
  // conditional dropdown in <DealStepper/>.
  canAdvance: z.boolean().optional(),
});
export type ThreadItem = z.infer<typeof ThreadItem>;

export const ThreadList = z.object({ items: z.array(ThreadItem) });
export type ThreadListResponse = z.infer<typeof ThreadList>;

// --- Write shapes --------------------------------------------------------
// `threadId` comes from the URL, `senderId` from the session — NEVER trust
// either as a body field.
export const CreateMessage = z.object({
  body: z.string().min(1, "Message can't be empty").max(2000),
  attachmentUrl: z.string().url().optional(),
  attachmentFilename: z.string().max(255).optional(),
  attachmentMimeType: z.string().max(128).optional(),
});
export type CreateMessage = z.infer<typeof CreateMessage>;

export const CreateThread = z.object({
  lotId: z.string().min(1),
});
export type CreateThread = z.infer<typeof CreateThread>;

// Create a broker-group room. The server validates that each `inviteeUserIds`
// entry is either in the caller's accepted `Connection` network OR a
// `VERIFIED` company (Profile.verificationStatus). Self-invites are
// rejected. `description` is optional and renders under the room name in
// the right-pane header.
export const CreateRoomInput = z.object({
  name: z.string().trim().min(1, 'Enter a room name').max(120, 'Room name is too long'),
  description: z.string().trim().max(1000, 'Description is too long').optional(),
  inviteeUserIds: z
    .array(z.string().min(1))
    .min(1, 'Pick at least one person to invite')
    .max(50, 'Too many invitees'),
});
export type CreateRoomInput = z.infer<typeof CreateRoomInput>;

// Response from POST /api/rooms — the just-created room's wire shape with
// full member roster. The client islands navigate to
// /dashboard/messages?thread=<id> on success.
export const RoomCreated = z.object({
  id: z.string(),
  kind: ThreadKind,
  subject: z.string(),
  description: z.string().nullable(),
  createdAt: z.string(),
  lastMessageAt: z.string(),
  memberCount: z.number().int().nonnegative(),
  members: z.array(ParticipantItem),
});
export type RoomCreated = z.infer<typeof RoomCreated>;

// Invitees pool for the create-room picker — caller's accepted network
// denormalised (Connection rows) + every verified-companies profile
// (verificationStatus === 'VERIFIED'). The client merges + dedupes by
// `userId` so a person who is BOTH a member of the caller's network AND
// a verified company only appears once.
export const InviteeItem = z.object({
  userId: z.string(),
  displayName: z.string(),
  companyName: z.string().nullable(),
  handle: z.string().nullable(),
  // Which pool the invitee came from on this row. A user can appear in
  // both pools; the picker merges them.
  source: z.enum(['NETWORK', 'VERIFIED_COMPANY']),
});
export type InviteeItem = z.infer<typeof InviteeItem>;

export const InviteeList = z.object({
  items: z.array(InviteeItem),
  networkCount: z.number().int().nonnegative(),
  verifiedCount: z.number().int().nonnegative(),
});
export type InviteeList = z.infer<typeof InviteeList>;

// Adding a new participant to a thread. `identifier` is intentionally
// freeform — the server picks email-vs-companyName lookup by first trying
// `User.email` (case-insensitive) and falling back to a unique
// `Profile.companyName` match. Multiple-match company names are a 409 at
// the route (not a contract-level multi-match), since the schema can't
// represent "ambiguous".
export const CreateParticipant = z.object({
  identifier: z.string().min(1).max(320),
});
export type CreateParticipant = z.infer<typeof CreateParticipant>;

// --- Composite detail response — single round-trip for /messages/[id] ---
// `participants` is the full roster (with profile fields) so the right pane
// can render them and host the add-participant form. The list endpoint
// returns only `participantCount` (see ThreadItem) to stay O(1) per row.
// (`ParticipantItem` is declared earlier so the `ThreadItem.members` field
// can be typed against it.)

export const ThreadDetail = z.object({
  thread: ThreadItem,
  messages: z.array(MessageItem),
  participants: z.array(ParticipantItem),
});
export type ThreadDetail = z.infer<typeof ThreadDetail>;

export const ParticipantList = z.object({ items: z.array(ParticipantItem) });
export type ParticipantList = z.infer<typeof ParticipantList>;

// --- Standalone list (e.g. polling-update later) -----------------------
export const MessageList = z.object({ items: z.array(MessageItem) });
export type MessageList = z.infer<typeof MessageList>;

// --- Attachment upload response -----------------------------------------
export const AttachmentUploadResponse = z.object({
  url: z.string(),
  filename: z.string(),
  mimeType: z.string(),
});
export type AttachmentUploadResponse = z.infer<typeof AttachmentUploadResponse>;

// --- Deal-status stepper ------------------------------------------------
// Canonical stepper sequence — used by the server to validate forward-only
// transitions AND by the client to render the wire strip in the right
// order. Mirrors the prisma/schema/messaging.prisma#DealStatus enum. The
// 7-element order is the source of truth; do NOT reorder this array
// without renumbering prisma's enum identically.
export const DealStatusEnum = z.enum([
  'OFFER',
  'ACCEPTED',
  'PO_ISSUED',
  'PICKUP_SCHEDULED',
  'IN_TRANSIT',
  'DELIVERED',
  'COMPLETED',
]);
export type DealStatus = z.infer<typeof DealStatusEnum>;
export const DEAL_STATUS_ORDER: readonly DealStatus[] = [
  'OFFER',
  'ACCEPTED',
  'PO_ISSUED',
  'PICKUP_SCHEDULED',
  'IN_TRANSIT',
  'DELIVERED',
  'COMPLETED',
] as const;

// Wire response from PATCH /api/threads/[id]/deal-status. The route
// returns the JUST-updated state so the client island can update local
// state without a second round-trip on the same screen.
export const DealStatusUpdated = z.object({
  threadId: z.string(),
  dealStatus: DealStatusEnum,
  dealStatusUpdatedAt: z.string().nullable(),
});
export type DealStatusUpdated = z.infer<typeof DealStatusUpdated>;

// Wire response from GET /api/threads/[id]/deal-status. Includes the
// server-stamped `canAdvance` so the client island can render the
// dropdown without a second permission round-trip.
export const DealStatusState = z.object({
  threadId: z.string(),
  dealStatus: DealStatusEnum,
  dealStatusUpdatedAt: z.string().nullable(),
  canAdvance: z.boolean(),
  orderedSteps: z.array(DealStatusEnum),
});
export type DealStatusState = z.infer<typeof DealStatusState>;

// Body of PATCH /api/threads/[id]/deal-status — only the target step
// is needed; the current state is read server-side and the index math
// (target vs current) decides whether to advance.
export const UpdateDealStatus = z.object({
  dealStatus: DealStatusEnum,
});
export type UpdateDealStatusInput = z.infer<typeof UpdateDealStatus>;

// Body of GET /api/lots/[id]/deal-status — resolves the caller's own
// active thread with this lot's seller (or null if there is none).
export const LotDealStatus = z.object({
  threadId: z.string(),
  dealStatus: DealStatusEnum,
  dealStatusUpdatedAt: z.string().nullable(),
  canAdvance: z.boolean(),
  orderedSteps: z.array(DealStatusEnum),
});
export type LotDealStatusValue = z.infer<typeof LotDealStatus>;

export const LotDealStatusResponse = z.object({
  dealStatusBlock: LotDealStatus.nullable(),
});
export type LotDealStatusResponseValue = z.infer<typeof LotDealStatusResponse>;
