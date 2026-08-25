# Meldstock Phase 1C.3 Prisma Migration Baseline Report

## 1. Scope and outcome

This phase created and verified the reproducible marketplace Prisma migration baseline for Meldstock.

The accepted migration history already owns:
- Better Auth tables: `user`, `session`, `account`, `verification`
- Better Auth admin columns
- the isolated accepted `Connection` migration and `ConnectionStatus` enum

The missing baseline consisted of the marketplace tables and enums already inventoried in the accepted Phase 1C.2 report. The repository was reconciled against the current multi-file Prisma schema before authoring the baseline migration.

Outcome: a new migration, `20260825000000_marketplace_baseline`, was generated and applied to a fresh disposable PostgreSQL database using only `prisma migrate deploy` and without any `db push` or `--accept-data-loss` step.

## 2. Files changed

- `prisma/migrations/20260825000000_marketplace_baseline/migration.sql`
- `tests/unit/phase1c3-baseline.test.ts`
- `tests/unit/phase1c3-database-smoke.test.ts`
- `docs/PHASE1C3_PRISMA_MIGRATION_BASELINE_REPORT.md`

The handoff file itself, `Meldstock_Phase_1C3_Handoff.md`, was used as context only and was not committed or modified.

## 3. Confirmed pre-baseline inventory

The current schema reconciles to the following missing objects that were absent from committed migration history:

Models (15):
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

Enums (17):
- `LotType`
- `LotVisibility`
- `Polymer`
- `LotCondition`
- `LotLifecycleStatus`
- `DocumentType`
- `ThreadKind`
- `TransactionStatus`
- `DealStatus`
- `NotificationKind`
- `OfferStatus`
- `PriceUnit`
- `FreightTerm`
- `BusinessRole`
- `VerificationStatus`
- `RatingDimension`
- `WantedResponseStatus`

The migration includes the required PostgreSQL-specific column definitions, defaults, composite primary keys, unique constraints, and every index captured in the accepted inventory, including:
- `MessageThread` unique constraint on `(lotId, buyerId)`
- `ThreadReadState` composite primary key on `(threadId, userId)`
- `ThreadParticipant` composite primary key on `(threadId, userId)`
- `Profile` unique constraints on `userId` and `handle`
- `Rating` unique constraint on `(threadId, raterId, dimension)`
- `Offer` and `WantedResponse` self-relations via `parentOfferId` / `parentResponseId`
- all `@@index` entries declared in the schema

## 4. Migration creation method

The migration was generated from the accepted migration state using Prisma's supported diff tooling:

```bash
DATABASE_URL='postgresql://postgres:postgres@localhost:5432/meldstock?schema=public' \
  ./node_modules/.bin/prisma migrate diff \
  --from-url 'postgresql://postgres:postgres@localhost:5432/meldstock?schema=public' \
  --to-schema-datamodel prisma/schema \
  --script
```

This produced the SQL for the missing marketplace objects only. The output was then reviewed and normalized into the final migration file in `prisma/migrations/20260825000000_marketplace_baseline/migration.sql`.

The migration intentionally does not recreate or alter any Better Auth tables or the isolated `Connection` migration objects, preserving prior migration history and checksums.

## 5. Complete SQL object inventory

The final SQL creates exactly the missing objects required by the current Prisma schema:

### Enums created
- `LotType`
- `LotVisibility`
- `Polymer`
- `LotCondition`
- `LotLifecycleStatus`
- `DocumentType`
- `ThreadKind`
- `TransactionStatus`
- `DealStatus`
- `NotificationKind`
- `OfferStatus`
- `PriceUnit`
- `FreightTerm`
- `BusinessRole`
- `VerificationStatus`
- `RatingDimension`
- `WantedResponseStatus`

### Tables created
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

### Constraints and relations in the final SQL
- primary keys for all new tables
- composite primary keys for `ThreadReadState` and `ThreadParticipant`
- unique indexes for `MessageThread(lotId, buyerId)`, `Profile(userId)`, `Profile(handle)`, and `Rating(threadId, raterId, dimension)`
- self-relations for `Offer.parentOfferId` and `WantedResponse.parentResponseId`
- cascade delete on `ThreadReadState.threadId`, `Message.threadId`, and `ThreadParticipant.threadId`
- no additional ownership changes to Better Auth or `Connection`

## 6. Protection of Better Auth and Connection history

This migration deliberately preserves the accepted auth and `Connection` history:

- no `CREATE TABLE "user"`, `"session"`, `"account"`, or `"verification"`
- no `ALTER TABLE "user"` or `"session"` admin plugin changes
- no duplicate `ConnectionStatus` or `Connection` re-creation
- no alteration of migration ordering or prior SQL file content

The accepted Phase 1B.5 `Connection` migration remains isolated and intact. The baseline migration adds only the missing marketplace objects after it.

## 7. Disposable PostgreSQL setup

A disposable database was created with Docker and used only for validation:

```bash
docker run --rm -d --name meldstock-phase1c3-pg \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_DB=meldstock \
  -p 127.0.0.1:5432:5432 postgres:16-alpine
```

Then a fresh empty database was used for the baseline proof:

```bash
CREATE DATABASE meldstock_phase1c3;
```

No production database, no real user data, and no production connection strings were used.

## 8. Fresh-database migration and zero-drift proof

Fresh-database proof was executed against a new empty PostgreSQL database using the repository’s pinned local Prisma CLI, in this order: fresh empty database, `migrate deploy`, `generate`, `validate`, `migrate status`, then `migrate diff --exit-code --script`.

```bash
DATABASE_URL='postgresql://postgres:postgres@localhost:5432/meldstock_phase1c3?schema=public' \
  ./node_modules/.bin/prisma migrate deploy

DATABASE_URL='postgresql://postgres:postgres@localhost:5432/meldstock_phase1c3?schema=public' \
  ./node_modules/.bin/prisma generate

DATABASE_URL='postgresql://postgres:postgres@localhost:5432/meldstock_phase1c3?schema=public' \
  ./node_modules/.bin/prisma validate

DATABASE_URL='postgresql://postgres:postgres@localhost:5432/meldstock_phase1c3?schema=public' \
  ./node_modules/.bin/prisma migrate status

DATABASE_URL='postgresql://postgres:postgres@localhost:5432/meldstock_phase1c3?schema=public' \
  ./node_modules/.bin/prisma migrate diff \
  --from-url 'postgresql://postgres:postgres@localhost:5432/meldstock_phase1c3?schema=public' \
  --to-schema-datamodel prisma/schema \
  --exit-code \
  --script
```

Exact result:
- Prisma version: `6.19.3`
- `migrate diff --exit-code --script` output: `-- This is an empty migration.`
- exit code: `0`
- `migrate deploy` applied 4 migrations successfully
- `prisma validate` reported: `The schemas at prisma/schema are valid 🚀`
- `prisma migrate status` reported: `Database schema is up to date!`

Query-based schema proof also confirmed all 20 models and 18 enums were present in the fresh database.

## 9. Database-backed smoke tests

A focused disposable-database smoke test was executed directly against the fresh PostgreSQL database.

Exact command:

```bash
DATABASE_URL='postgresql://postgres:postgres@localhost:5432/meldstock_phase1c3?schema=public' \
  MELDSTOCK_DB_SMOKE=1 \
  ./node_modules/.bin/vitest run tests/unit/phase1c3-database-smoke.test.ts
```

Exact result:
- Test files: `1 passed (1)`
- Tests: `4 passed (4)`
- The test executed normally and was not skipped; the gate is intentionally satisfied by `MELDSTOCK_DB_SMOKE=1` and the explicit disposable `DATABASE_URL`, which confirms the database-backed smoke coverage is active and real.

Key coverage:
- Better Auth `user` / `session` / `account` creation and physical mapping
- `Connection` pending default and unique constraints
- representative `Profile`, `Lot`, `MessageThread`, `Message`, `Offer`, `WantedResponse`, `Rating`, `SavedSearch`, and `Notification` creation/write paths
- uniqueness validation across the marketplace schema

The smoke file is `tests/unit/phase1c3-database-smoke.test.ts` and is intentionally gated behind an explicit disposable database configuration so it remains isolated and deterministic.

## 10. Full regression results

Full repo verification run from the handoff checklist:

```bash
npm test
npm run typecheck
npm run lint
DATABASE_URL='postgresql://postgres:postgres@localhost:5432/meldstock_phase1c3?schema=public' npm run db:validate
SKIP_ENV_VALIDATION=1 npm run build
git diff --check
```

Observed results:

### `npm test`
- Result: PASS
- 23 test files passed and 1 database smoke test file was skipped
- 188 tests passed and 1 smoke-test placeholder was skipped

### `npm run typecheck`
- Result: accepted baseline failure only
- Exactly 16 diagnostics remain in the existing baseline, all in `tests/unit/audit.test.ts` and `tests/unit/thread-digest.test.ts`
- No new TypeScript errors were introduced by this phase

### `npm run lint`
- Result: passes with the accepted five warnings in `jobs/stale-nudge.js`
- No new warning or error introduced by the migration work

### `DATABASE_URL='postgresql://postgres:postgres@localhost:5432/meldstock_phase1c3?schema=public' npm run db:validate`
- Result: PASS
- Output: `The schemas at prisma/schema are valid 🚀`

### `SKIP_ENV_VALIDATION=1 npm run build`
- Result: PASS

### `git diff --check`
- Result: PASS

## 11. Existing-database reconciliation boundary and future strategy

This phase intentionally does not execute any existing-database reconciliation.

The safe future path for an already-existing independently managed database is:
1. inventory the target DB offline and verify schema ownership
2. isolate all existing app tables and data before applying any migration
3. create a deliberate reconciliation/marking strategy for migration state, not a blanket table creation
4. treat historical rows as needing review rather than assuming they are safe to auto-upgrade
5. preserve the separate fresh-database proof path from any existing-database adoption path

This boundary is deliberately explicit: a fresh migration proof is not a blanket guarantee that an existing database can receive the migration without review.

## 12. Remaining limitations

- This phase does not redesign the plastics taxonomy or Company architecture.
- This phase does not perform a legacy-storage migration.
- This phase does not deploy or select vendors.
- Existing database reconciliation remains a future, separate operational task.
- The repository still carries the accepted baseline TypeScript diagnostics and stale-nudge lint warnings as pre-existing conditions.

## 13. Recommended next phase

The next operational step should be a focused adoption review for a separately managed existing database, followed by final runtime validation on a dedicated disposable environment. Once that boundary is explicitly managed, the next product phase can proceed without violating the migration baseline established here.

---

## Summary

The Phase 1C.3 migration baseline is complete: a new marketplace baseline migration was created, applied successfully to a fresh disposable PostgreSQL database, validated via `prisma generate`/`validate`/`status`, and the repo regression checks were recorded with their accepted baseline conditions.

`docs/PHASE1C3_PRISMA_MIGRATION_BASELINE_REPORT.md` is ready for review.
