# Meldstock Phase 1C.2 Independent Runtime Report

Date: 2026-08-18  
Branch: `codex/phase1c2-independent-runtime-prep`

## 1. Scope and outcome

This preparation slice makes the historical Polsia deployment path inactive,
defines the independent runtime contract, adds safe Prisma command aliases,
inventories the exact migration gap, and constrains compatibility reads of
legacy storage URLs. It does not deploy, access production, choose permanent
vendors, create the marketplace migration baseline, or change marketplace,
plastics, or Company models.

## 2. Files changed

- Runtime/configuration: `package.json`, `.env.example`, `README.md`,
  `src/lib/env.ts`, `src/instrumentation.ts`, `src/app/health/route.ts`, and
  `jobs/stale-nudge.js`.
- Storage boundary: `src/lib/services/storage.ts` and
  `src/lib/services/index.ts`.
- Active schema comments corrected: `prisma/schema/{lots,messaging,offer,profiles,saved-searches,wanted-responses}.prisma`.
- Historical archive: root `polsia.toml` moved to
  `docs/archive/polsia/polsia.toml.historical` with a prominent non-runtime warning.
- Documentation: `docs/INDEPENDENT_RUNTIME.md` and this report.
- Tests: `tests/unit/phase1c2-runtime.test.ts`.

No secret or production data was added or inspected.

## 3. Historical Polsia deployment quarantine

The executable-looking root `polsia.toml` was removed from the repository root
and preserved byte-for-byte apart from an archival warning under a non-manifest
`.historical` filename. The archived file retains the original build, database,
health, and cron provenance, including its unsafe historical startup command,
but no active npm script or current runtime document references it.

README runtime guidance, the stale-nudge comment, startup instrumentation, and
live Prisma schema comments no longer describe the Polsia manifest or a schema
push as current behavior. Historical handoff/audit reports and
`AGENTS.polsia.md` remain unchanged as provenance and are not runtime instructions.

## 4. Active independent runtime commands

| Purpose | Command |
|---|---|
| Install | `npm ci` |
| Generate client | `npm run db:generate` (`prisma generate`) |
| Validate schema | `npm run db:validate` (`prisma validate`) |
| Development migration authoring | `npm run db:migrate:dev` (`prisma migrate dev`) |
| Release migration application | `npm run db:migrate:deploy` (`prisma migrate deploy`) |
| Tests/type/lint | `npm test`, `npm run typecheck`, `npm run lint` |
| Build/start | `npm run build`, `npm start` |
| Stale nudge | `npm run job:stale-nudge` |

There is no active production or development schema-push script. Migration
application is intentionally separate from application startup.

## 5. Environment/runtime contract

The complete contract is in `docs/INDEPENDENT_RUNTIME.md`. In summary:

- Node.js `>=20.18.1`, npm, Next.js 16, and PostgreSQL are required.
- `DATABASE_URL`, `BETTER_AUTH_SECRET`, and `BETTER_AUTH_URL` are core server
  settings. Additional Better Auth origins must be explicit in
  `BETTER_AUTH_TRUSTED_ORIGINS`.
- Optional `MELDSTOCK_BOOTSTRAP_ADMIN_EMAIL` grants admin only during creation
  of a matching new account; it is not an ongoing promotion mechanism.
- Local mail, local opaque-key storage, disabled AI, no-op analytics, and manual
  scheduling are safe defaults and require no Polsia credentials.
- `GET /health` is the process-level health endpoint.
- A provider-neutral scheduler should invoke the one-shot stale-nudge npm job.

No permanent mail, storage, AI, analytics, scheduler, database-hosting, or web
hosting vendor is selected.

## 6. Complete migration-gap inventory

### Represented by committed migrations

Committed history consists of three migrations:

1. `20260603000000_init_better_auth` creates `User` (`user`), `Session`
   (`session`), `Account` (`account`), and `Verification` (`verification`), the
   `user.email` and `session.token` unique indexes, and the Session/Account to
   User cascading foreign keys.
2. `20260612000000_add_better_auth_admin` adds User role/ban columns and
   Session `impersonatedBy`. It depends on the first migration's auth tables.
3. `20260817000000_connection_request_accept` creates `ConnectionStatus`,
   ensures a minimal legacy `Connection` table exists, adds request/status/
   acceptance columns, preserves canonical pair uniqueness, and creates the
   three status-aware indexes.

Thus the schema models represented are `User`, `Session`, `Account`,
`Verification`, and `Connection`. The only represented Prisma enum is
`ConnectionStatus`.

### Marketplace models absent from migration history

The following 15 current models have no committed table-creation migration:

- `AuditEvent`
- `Lot`
- `LotMessage`
- `Document`
- `MessageThread`
- `ThreadReadState`
- `Message`
- `ThreadParticipant`
- `Notification`
- `Offer`
- `Profile`
- `VerificationRequest`
- `Rating`
- `SavedSearch`
- `WantedResponse`

### Marketplace enums absent from migration history

The following 17 current enums have no committed creation migration:

- `LotType`, `LotVisibility`, `Polymer`, `LotCondition`, `LotLifecycleStatus`,
  `DocumentType`
- `ThreadKind`, `TransactionStatus`, `DealStatus`
- `NotificationKind`
- `OfferStatus`, `PriceUnit`, `FreightTerm`
- `BusinessRole`, `VerificationStatus`
- `RatingDimension`
- `WantedResponseStatus`

### Missing unique constraints and indexes

Because the 15 tables above are absent, all of their schema-declared indexes
and uniqueness constraints are also absent from migration history:

- `AuditEvent`: four indexes covering resource/time, user/time, action/time,
  and created time.
- `Lot`: seven indexes covering type/time, time, owner, visibility,
  owner/visibility, owner/status, and status/update time.
- `LotMessage` and `Document`: each has a lot/time index.
- `MessageThread`: unique `(lotId,buyerId)` plus eight indexes for buyer,
  seller, lot, RFQ, kind, creator, transaction status, and deal status.
- `ThreadReadState`: composite primary key `(threadId,userId)` and user index.
- `Message`: thread/time index.
- `ThreadParticipant`: composite primary key `(threadId,userId)` and user index.
- `Notification`: user/time and user/read/time indexes.
- `Offer` and `WantedResponse`: each has thread/time, lot/status, parent, and
  status/accepted-time indexes.
- `Profile`: field-level unique constraints on `userId` and `handle`, plus
  user, verification status, and role indexes.
- `VerificationRequest`: status/time, profile, and profile/status indexes.
- `Rating`: unique `(threadId,raterId,dimension)` plus ratee/dimension and
  thread indexes.
- `SavedSearch`: user/time and user/name indexes.

Primary keys and the Offer/WantedResponse self-relation foreign keys are also
necessarily absent with their tables. Scalar cross-domain IDs intentionally do
not declare Prisma relations in the current schema and therefore do not imply
additional missing foreign-key migrations.

### Phase 1B.5 Connection behavior

The Connection migration is deliberately isolated. On an empty database it
creates the minimal legacy Connection shape before adding consent fields, so it
can apply after the auth migrations even though the marketplace baseline is
missing. Existing rows default to `PENDING`; requester and acceptance timestamps
remain null, so no historical relationship is silently trusted. Its enum,
columns, canonical unique constraint, and three status-aware indexes match the
current Connection schema. It does not make the rest of the schema reproducible.

### Better Auth dependencies

Better Auth requires all four lowercase physical auth tables. Session and
Account foreign keys depend on `user`; the admin migration depends on `user`
and `session` already existing. The future baseline must preserve these existing
migration checksums/order and the `@@map` lowercase names. It must not recreate
auth objects or Connection objects already owned by committed history.

## 7. Proposed Phase 1C.3 migration-baseline strategy

1. Freeze and review the current multi-file Prisma schema; do not alter plastics
   or Company architecture while baselining.
2. Generate SQL in an offline/disposable context for the difference between a
   database produced by the three committed migrations and the complete current
   schema. Do not introspect or connect to production.
3. Review the SQL manually for all 15 tables, 17 enums, defaults, decimal/time/
   JSON types, self-relations, primary keys, unique constraints, and every index
   listed above. Exclude auth and Connection objects already represented.
4. Commit one clearly named marketplace-baseline migration after review. Do not
   rewrite or squash accepted migration history.
5. Prove from a brand-new disposable PostgreSQL database that
   `npm run db:migrate:deploy` alone produces a schema with zero Prisma drift and
   a generated client matching all 20 models and 18 enums.
6. Add database-backed smoke tests for Better Auth creation/session behavior,
   pending Connection defaults, and representative marketplace writes/reads.
7. Separately plan how an already-existing independently managed database will
   mark/reconcile the baseline; never blindly apply table-creation SQL to it.

The target invariant is: empty PostgreSQL database → `prisma migrate deploy` →
complete Meldstock schema, without a schema-push step.

## 8. Legacy-storage compatibility policy

Storage references have three classes:

1. New provider-neutral objects use adapter-owned opaque keys such as
   `local:v1:<uuid>`. They are never interpreted as URLs.
2. Trusted historical Polsia-managed references are HTTPS URLs whose exact
   origin is explicitly configured in `POLSIA_LEGACY_STORAGE_ORIGINS` while the
   temporary Polsia storage adapter is selected. Credentials in URLs, HTTP,
   redirects, and origins outside the allowlist are rejected.
3. Any other absolute URL, user-controlled remote URL, filesystem path, or
   malformed key is untrusted and must not be fetched.

The allowlist is operator-supplied because this repository has no production
inventory of historical object hosts and this slice did not inspect production.
The adapter validates both uploaded response URLs and legacy reads. A future
data migration should inventory values offline, map only proven trusted legacy
origins to new object keys, copy through a controlled migration worker, and
quarantine unknown values for manual review. It must not broadly fetch arbitrary
row URLs.

## 9. Codespaces/local setup

`docs/INDEPENDENT_RUNTIME.md` documents clone, `npm ci`, a safe `.env`, Prisma
generate/validate, tests, build, start, health check, and a disposable
`postgres:16-alpine` Docker command suitable for Codespaces. Local provider
defaults require no Polsia credentials and do not send mail, AI, or analytics
requests. `ENABLE_DEMO_SEED=0` prevents demo data creation.

Because this slice intentionally does not create the marketplace baseline, a
new disposable database can validate current migrations but cannot yet support
the complete marketplace. That limitation is stated at each relevant setup step.

## 10. Tests and verification

Focused Phase 1C.2 tests prove that active npm runtime scripts contain neither
the schema-push command nor the historical data-loss flag; the migration command
is exactly `prisma migrate deploy`; no root deployment manifest exists or is
referenced by active scripts; default services are local/disabled/no-op; and
the legacy adapter rejects arbitrary HTTP/HTTPS origins before any fetch.

| Check | Result |
|---|---|
| `npm test` | PASS: 22 files, 187 tests |
| `npm run typecheck` | Expected accepted baseline failure only: exactly 16 strict-test diagnostics (15 in `tests/unit/audit.test.ts`, 1 in `tests/unit/thread-digest.test.ts`); no Phase 1C.2 diagnostic |
| `npm run lint` | PASS with the same five pre-existing `jobs/stale-nudge.js` warnings |
| `npx prisma validate` | PASS with a non-secret local placeholder `DATABASE_URL` |
| `SKIP_ENV_VALIDATION=1 npm run build` | PASS with all Polsia provider variables removed; expected Better Auth envless-build warnings only |
| `git diff --check` | PASS |

The first sandboxed build attempt hit the known Turbopack restriction on
binding its local CSS-worker port. The same build passed in the already-approved
build environment. No check deployed, contacted production, applied migrations,
or ran a schema-push command.

## 11. Remaining limitations

- The complete marketplace migration baseline does not exist; fresh-database
  full operation is deferred to Phase 1C.3.
- No production or existing real database reconciliation strategy has been
  executed; it requires separate review after the empty-database baseline.
- The legacy Polsia adapters remain temporary opt-in compatibility code. Known
  historical storage origins must be supplied by an authorized operator.
- Local filesystem storage is development-only and single-node.
- Health is process-level, not a database/provider readiness test.
- Existing mocked/unit coverage is not the required complete marketplace E2E.
- Historical reports, metadata, banners, and archived configuration still
  mention Polsia and old deployment behavior by design; they are provenance.

## 12. Recommended next phase

After review, Phase 1C.3 should create and verify only the complete reproducible
Prisma migration baseline on disposable PostgreSQL, following the strategy
above. It should not choose permanent providers, access production, redesign
marketplace behavior, or change plastics/Company models.
