# Meldstock Phase 1B Authorization Report

Date: 2026-08-14  
Branch: `codex/phase1b-authorization`

## 1. Scope and outcome

This review covered the existing commercial authorization boundaries for legacy lot messages, authenticated message threads, participant additions, listing and thread documents, `MY_NETWORK` visibility, offers, WANTED responses, deal status, ratings, saved searches, notifications, verification, and listing lifecycle actions.

No Prisma schema, migration, provider integration, deployment configuration, plastics model, Company model, matching logic, or new marketplace feature was changed.

Phase 1B retired the unsafe shared lot-message channel, moved signed-in listing contact to authenticated `MessageThread` records, restricted participant disclosure, made invalid historical participant additions fail authorization, protected listing-document bytes behind authentication, strengthened anonymous-listing masking, and made `MY_NETWORK` fail closed until accepted connections can be represented correctly.

## 2. Vulnerabilities and issues found

1. `GET/POST /api/lots/[id]/messages` exposed one shared negotiation stream to every viewer who could see a PUBLIC or ANONYMOUS listing. POST trusted `senderName` from the request.
2. The lot detail endpoint also embedded those shared `LotMessage` rows, so retiring only the dedicated route would not have removed the read leak.
3. `POST /api/threads/[threadId]/participants` allowed every participant to add an arbitrary account and expose existing messages and attachments.
4. Access checks trusted every `ThreadParticipant` row, including historical rows added by an unauthorized buyer or ordinary room member.
5. Authenticated thread creation refused ANONYMOUS listings and directed buyers back to the unsafe public message stream.
6. Thread list/detail/participant/message and attachment filename responses could expose an ANONYMOUS listing owner's user ID, profile, handle, or original seller-supplied filename.
7. Listing-document downloads followed listing visibility, allowing anonymous downloads from PUBLIC and ANONYMOUS listings.
8. The `Connection` model has no requester or acceptance state. A unilateral canonical pair was treated as mutual `MY_NETWORK` access and could also receive saved-search notifications for a private listing.
9. Seller-authorized extra thread participants could use the generic participant checks to close a deal or rate one of the actual parties, even though they were not the buyer or seller.

## 3. Previous behavior

- Public/anonymous listing visibility implied visibility of the legacy commercial message stream.
- A client supplied the trusted-looking legacy sender name.
- Any thread participant could silently add another account to a commercial thread or broker room.
- Any stored participant row granted message and attachment access.
- ANONYMOUS listing contact used the shared legacy stream; the authenticated thread route rejected it.
- Thread wires could reveal the anonymous owner through `sellerId`, `otherParty`, participant rows, message sender IDs, or filenames.
- Anyone allowed to view a PUBLIC/ANONYMOUS listing could download its COA/TDS/SDS bytes without signing in.
- A unilateral `Connection` row immediately unlocked `MY_NETWORK` reads and notification fan-out.
- Any permitted thread participant could mark closeout state or create ratings.

## 4. New behavior

- `GET/POST /api/lots/[id]/messages` now returns `410 Gone` and never reads or writes `LotMessage` rows.
- Lot detail responses return an empty legacy `messages` collection. The legacy dialog/polling UI was removed from the listing detail page.
- A signed-in interested party opens a server-authorized `MessageThread`; thread creation now applies the listing visibility policy before creating anything.
- ANONYMOUS listings can use authenticated threads. For a non-owner viewer, the API masks the owner profile, owner user ID, owner message sender IDs, participant identity, and seller-provided attachment/document filenames. The owner still sees the interested buyer's real identity.
- Message writes continue deriving `senderId` exclusively from the authenticated session. The strict request contract rejects a client `senderId`.
- Commercial LISTING/RFQ threads may add participants only through the thread seller/listing-owner role. BROKER_GROUP rooms remain creator-managed.
- Stored third-party participant rows authorize access only when `addedBy` is the commercial seller or room creator. Buyer-added, ordinary-member-added, and un-attributed legacy extras fail closed and are excluded from rosters/counts.
- Invited third parties may participate in the conversation and read its attachments, but only the actual buyer/seller may close the deal or rate it. Seller/admin-only operational deal advancement remains unchanged.
- Listing document metadata remains visible with the listing so the marketplace can show availability. Document bytes now require authentication and then re-apply listing visibility. ANONYMOUS listing filenames are replaced with generated neutral names on metadata and download responses.
- `MY_NETWORK` listings are visible only to their owner and send no saved-search notifications until accepted relationships can be represented. This is an intentional temporary fail-closed behavior.

## 5. Authorization policy implemented

| Resource/action | Read policy | Mutation policy |
|---|---|---|
| Legacy lot messages | None; route retired (`410`) | None; route retired (`410`) |
| Listing/RFQ thread | Buyer, seller, seller-authorized added participant | Authenticated authorized participant may message; sender comes from session |
| Commercial participant roster | Authorized participants | Seller/listing owner only |
| Broker-group room | Creator and creator-added participants | Creator only may add participants; existing creator-seeded room behavior preserved |
| Thread attachment | Authorized thread participant on every download | Authenticated participant upload/message binding from Phase 1A |
| Listing document metadata | Anyone allowed by listing visibility | Listing owner upload |
| Listing document bytes | Authenticated user also allowed by listing visibility | No public mutation |
| HAVE offers | Offer buyer and seller only | Initial buyer creates; seller counters; current counterpart accepts/declines; author withdraws |
| WANTED responses | RFQ poster and the individual respondent only | Respondent creates; RFQ poster counters/accepts/declines; author withdraws |
| Operational deal advancement | Authorized thread reader | Seller or platform admin only |
| Deal closeout | Actual buyer or seller | Actual buyer or seller only |
| Ratings | Aggregate remains public; per-thread status limited to actual parties | Completed-deal buyer or seller only; ratee derived server-side |
| Saved searches | Authenticated owner only | Authenticated owner only |
| Notifications | Authenticated recipient only | Recipient-scoped read changes |
| Verification decisions | Applicable owner/admin views | Better Auth `role === "admin"` only |
| Listing lifecycle | Visibility-filtered public reads | Listing owner or admin, depending on existing action |
| `MY_NETWORK` listing | Owner only until acceptance migration | Existing listing owner controls listing; no network fan-out |

Listing visibility never grants negotiation visibility. ANONYMOUS mode hides the listing owner from non-owner thread consumers; it does not hide an interested buyer from the listing owner.

## 6. Files changed

### Messaging, privacy, and participants

- `src/app/api/lots/[id]/messages/route.ts`
- `src/app/api/lots/[id]/route.ts`
- `src/app/api/messages/unread/route.ts`
- `src/app/api/threads/route.ts`
- `src/app/api/threads/[threadId]/route.ts`
- `src/app/api/threads/[threadId]/participants/route.ts`
- `src/app/api/threads/[threadId]/attachments/[msgId]/download/route.ts`
- `src/lib/business/anonymity.ts`
- `src/lib/business/thread-participants.ts`
- `src/components/custom/lot-detail.tsx`
- `src/components/custom/messages/message-seller-button.tsx`

### Documents, visibility, deal closeout, and ratings

- `src/app/api/lots/[id]/documents/[docId]/download/route.ts`
- `src/app/api/lots/route.ts`
- `src/app/api/ratings/route.ts`
- `src/app/api/ratings/status/[threadId]/route.ts`
- `src/app/api/threads/[threadId]/status/route.ts`
- `src/lib/business/lot-visibility.ts`

### Tests and report

- `tests/unit/phase1b-messaging.test.ts`
- `tests/unit/phase1b-participants.test.ts`
- `tests/unit/phase1b-authorization.test.ts`
- `docs/PHASE1B_AUTHORIZATION_REPORT.md`

## 7. Tests added

The Phase 1B tests prove:

- legacy anonymous read/write endpoints are retired;
- a signed-in buyer can create a private thread on an ANONYMOUS listing;
- the anonymous owner ID/profile is absent from that response;
- client-supplied sender identity is rejected;
- an unrelated authenticated user cannot read a thread;
- an ordinary commercial participant cannot add another account;
- the listing seller can add a participant;
- only the broker-room creator can add later room participants;
- unilateral Connection rows do not grant `MY_NETWORK` visibility;
- listing-document download requires authentication even for a public listing;
- unrelated users cannot read offer or RFQ response terms;
- buyer and seller role-specific counter actions remain separated;
- an invited third party cannot close a deal or create a rating;
- verification decisions remain admin-only.

Phase 1A tests continue proving owner IDs cannot be supplied through listing request bodies and unrelated users cannot download thread attachments.

## 8. Verification results

| Check | Result |
|---|---|
| `npm test` | PASS: 18 files, 168 tests |
| `npm run typecheck` | Expected baseline failure only: exactly 16 strict errors remain (15 in `tests/unit/audit.test.ts`, 1 in `tests/unit/thread-digest.test.ts`) |
| `npm run lint` | PASS with the same 5 pre-existing `jobs/stale-nudge.js` warnings |
| `npx prisma validate` | Literal command reported missing `DATABASE_URL`; PASS when repeated with non-secret local placeholder `postgresql://localhost:5432/meldstock_validation` |
| PowerShell equivalent of `SKIP_ENV_VALIDATION=1 npm run build` | PASS; expected Better Auth missing URL/default-secret warnings were emitted because no real secrets were supplied |
| `git diff --check` | PASS |

No test connected to a database, accessed production data, deployed the application, or ran a destructive Prisma command.

## 9. Remaining limitations

- The legacy `LotMessage` table/model remains in Prisma for data preservation. Its route and UI are retired; no deletion or data migration was attempted.
- Participant acceptance cannot be represented by the current schema. This slice uses a narrow authorized-adder rule, not invitee acceptance. Seller/creator-added users receive immediate access.
- Existing authorized seller/creator additions remain readable. Historical rows added by an unauthorized party or with no trusted `addedBy` fail closed but were not deleted.
- `MY_NETWORK` is temporarily unavailable to non-owners. Connections remain usable as a contact-management UI, but not as a confidentiality boundary.
- Arbitrary uploaded document content can itself contain identifying information. Meldstock masks generated filenames/metadata for ANONYMOUS listings but does not inspect or redact user PDF/image content.
- Listing document storage remains coupled to the Polsia proxy and stores an upstream URL. Provider migration and a first-class private object key are outside this slice.
- Route tests are mocked unit-level authorization tests. A disposable-database integration suite and browser E2E coverage for the complete seller/buyer lifecycle are still required.
- Concurrent offer/status transitions still use read-then-write patterns in places; conditional/idempotent database mutations remain future hardening.

## 10. Proposed Connection schema change intentionally not implemented

A correct request/accept workflow requires a reviewed Prisma migration. Proposed minimal change:

```prisma
enum ConnectionStatus {
  PENDING
  ACCEPTED
}

model Connection {
  id                String           @id @default(cuid())
  userIdA           String
  userIdB           String
  requestedByUserId String?
  status            ConnectionStatus @default(PENDING)
  createdAt         DateTime         @default(now())
  acceptedAt        DateTime?

  @@unique([userIdA, userIdB])
  @@index([userIdA, status])
  @@index([userIdB, status])
}
```

Migration and compatibility plan:

1. Add the enum/columns through a committed Prisma migration; do not use `db push`.
2. Backfill every existing row to `PENDING`, `requestedByUserId = null`, and `acceptedAt = null`. Existing canonical rows do not record who initiated them, so automatically marking them accepted or inventing a requester would be unsafe.
3. Treat `requestedByUserId = null` as a legacy relationship requiring reconfirmation. Either side may remove it or explicitly re-initiate; the other side must accept.
4. New POST requests set `requestedByUserId` from the session and `status = PENDING`. The client cannot supply either party ID as authority.
5. Add a target-only accept endpoint and requester cancel/target reject behavior. Acceptance stamps `status = ACCEPTED` and `acceptedAt` in one conditional update.
6. All listing visibility, saved-search fan-out, network picker, and room-network queries must filter `status = ACCEPTED`.
7. UI impact: separate Incoming, Sent/Pending, and Accepted states; `MY_NETWORK` copy must make acceptance explicit. Existing legacy rows should show “Reconfirmation required.”

This proposal was intentionally not applied because the Phase 1B instruction required stopping before any schema modification.

## 11. Recommended next Phase 1 slice

After review, the next slice should be the isolated Connection request/accept migration and its server/UI tests. It should not be combined with provider migration, deployment work, Company/plastics schema changes, matching redesign, or new marketplace features.
