# Meldstock Phase 1B.5 Connections Report

Date: 2026-08-17  
Branch: `codex/phase1b5-connections`

## 1. Scope and outcome

Phase 1B.5 restores `MY_NETWORK` as an accepted, mutual B2B relationship. It adds a small Prisma migration, a session-authorized request/accept workflow, minimal network-management UI, and accepted-only authorization for listing reads, document reads through the shared listing gate, saved-search notification fan-out, and broker-room network selectors.

No provider migration, Company/plastics schema work, matching or homepage redesign, deployment, or unrelated marketplace feature work was performed.

## 2. Prisma schema changes

Added `ConnectionStatus` with `PENDING` and `ACCEPTED` values. `Connection` now includes:

- `requestedByUserId String?`
- `status ConnectionStatus @default(PENDING)`
- `acceptedAt DateTime?`

The canonical `@@unique([userIdA, userIdB])` constraint remains. Status-aware indexes cover `(userIdA, status)`, `(userIdB, status)`, and `(requestedByUserId, status)`.

## 3. Migration created

Committed migration: `prisma/migrations/20260817000000_connection_request_accept/migration.sql`.

The migration creates the enum, adds the three columns, replaces the single-column party indexes with status-aware indexes, and preserves canonical pair uniqueness. It does not use `prisma db push`.

The exported repository's older migration history contains only Better Auth. To make this isolated migration verifiable on a fresh database, it uses a guarded `CREATE TABLE IF NOT EXISTS` for the legacy `Connection` shape before altering it. This is a no-op where the existing marketplace table is already present. `prisma.config.ts` now points Prisma explicitly at the already-committed `prisma/migrations` directory; without that setting Prisma 6 reported no migrations because the schema lives in `prisma/schema/`.

## 4. Legacy/backfill strategy

Existing rows receive the database default `PENDING`; `requestedByUserId` and `acceptedAt` remain `NULL`. No historical row is automatically accepted and no requester is invented.

The API and UI label these rows `Reconfirmation required`. They grant no `MY_NETWORK` access and are excluded from network selectors and saved-search fan-out. Either party can remove the legacy row. A party can also explicitly initiate reconfirmation by submitting the counterparty's handle/email; the update is conditional on the row still being legacy pending, and the other party must accept.

## 5. Connection authorization policy and API

`/api/connections` remains authenticated and party-scoped:

- `GET` returns the caller's incoming, outgoing, accepted, and legacy-reconfirmation rows.
- `POST` accepts only a strict target identifier object. It resolves the target server-side and always derives `requestedByUserId` from the authenticated session. New rows are `PENDING`. Self-requests fail. Same-direction pending and accepted duplicates are idempotent; a reverse pending request returns a conflict rather than silently accepting it.
- `PATCH` accepts a strict connection ID plus `ACCEPT` or `REJECT`. Only the non-requesting target party may act. Acceptance uses `updateMany` constrained by ID, `PENDING` status, requester, and party membership, so stale/concurrent transitions return `409` instead of changing newer state. Acceptance stamps `acceptedAt` with the server time.
- `DELETE` allows the requester to cancel an outgoing pending request, either party to remove an accepted connection, and either party to remove a legacy reconfirmation row. Incoming pending requests must use explicit rejection.

Clients cannot supply requester authority. Strict Zod inputs reject additional authority fields.

## 6. UI changes

The dashboard network page now presents:

- Incoming requests with Accept and Reject actions
- Outgoing/pending requests with Cancel
- Accepted connections with Remove
- Legacy rows marked Reconfirmation required

Copy consistently uses “Connection request,” “Pending,” and “Connected,” and explains that only accepted relationships can view `MY_NETWORK` listings.

## 7. `MY_NETWORK` behavior

The shared server-side listing visibility resolver now loads only `Connection.status = ACCEPTED` rows. Owners always retain access to their own listings. A different viewer receives access only when the accepted-network set contains the listing owner.

This shared gate covers lot browse/detail and listing document authorization, as well as other lot consumers such as comparables and price trends. Profile lot responses also use the same gate. Pending and legacy rows remain invisible.

Saved-search notification fan-out queries accepted connections between the listing owner and candidate recipients before sending. Broker-room invitee discovery and room creation also filter network relationships to `ACCEPTED`. Verified-company invitee behavior remains unchanged.

Messaging entry from a listing continues to apply the shared lot visibility gate before creating or exposing a thread, so a pending connection cannot use messaging to bypass listing confidentiality.

## 8. Tests added and updated

Added `tests/unit/phase1b5-connections.test.ts` with focused coverage proving:

- User A can request User B and requester identity comes from A's session.
- Self-request and a forged requester field are rejected.
- The requester cannot accept their own outgoing request.
- Unrelated User C cannot accept or reject another pair's request.
- The addressed target can accept.
- Stale/concurrent conditional acceptance fails safely.
- The requester can cancel and accepted rows can be removed by a party.
- A missing/pending network entry grants no `MY_NETWORK` access, an accepted resolved entry grants access, and removal from the accepted set revokes it.
- Visibility resolution, saved-search fan-out, and room network pickers require `ACCEPTED` status.

The Phase 1B visibility assertion was updated from temporary fail-closed behavior to the new accepted-network behavior. All Phase 1A and Phase 1B regression tests remain passing.

## 9. Migration verification

A disposable `postgres:16-alpine` container and empty `meldstock_phase1b5` database were used. No production connection or real user data was used.

`npx prisma migrate deploy` discovered and applied all three committed migrations, including `20260817000000_connection_request_accept`. Schema inspection confirmed:

- `status` is a non-null `ConnectionStatus` with default `PENDING`.
- `requestedByUserId` and `acceptedAt` are nullable.
- Canonical pair uniqueness remains.
- All three status-aware indexes exist.

The disposable container was stopped with automatic removal after verification.

## 10. Full verification results

| Check | Result |
|---|---|
| `npm test` | PASS: 19 files, 176 tests |
| `npm run typecheck` | Expected baseline failure only: exactly 16 strict test errors remain (15 in `tests/unit/audit.test.ts`, 1 in `tests/unit/thread-digest.test.ts`); no new errors |
| `npm run lint` | PASS; same 5 pre-existing `jobs/stale-nudge.js` warnings |
| `npx prisma validate` | PASS with a non-secret local placeholder `DATABASE_URL` |
| `SKIP_ENV_VALIDATION=1 npm run build` | PASS; expected Better Auth missing URL/default-secret warnings because real secrets were intentionally not supplied |
| `npx prisma migrate deploy` on disposable PostgreSQL | PASS; all committed migrations applied normally |
| `git diff --check` | PASS |

The first sandboxed build attempt failed because Turbopack was prohibited from binding a local CSS-worker port. The identical required build passed outside that restriction.

## 11. Remaining limitations

- Tests are mocked route/unit tests plus disposable migration verification, not a database-backed browser E2E suite.
- The repository still lacks a full marketplace migration baseline; this isolated migration safely handles `Connection`, but the broader reproducible production schema remains P2 work.
- `requestedByUserId` remains a scalar rather than a Prisma relation, consistent with the existing Better Auth schema separation.
- Legacy users must remove or explicitly reconfirm historical relationships; Meldstock intentionally performs no automatic trust upgrade.
- Network acceptance does not alter the separate seller/creator-controlled thread-participant invitation model reviewed in Phase 1B.

## 12. Recommended next phase

Stop after review of Phase 1B.5. The next phase should be selected explicitly; do not combine this accepted-connections slice with provider migration or broader database/schema redesign.
