# Meldstock Phase 1C.4 Existing-Database Adoption Readiness Report

## 1. Scope and outcome

This phase prepared a guarded, read-only workflow for deciding whether a
separately managed PostgreSQL database can be considered for adoption by the
accepted Prisma migration history.

It did not access production, deploy the application, copy application rows,
apply migrations, run `db push`, mark migrations as applied, or begin an
existing-database reconciliation.

Outcome: the repository now contains a dedicated local-clone audit, a pure
classification module, regression tests, and an operator runbook. The audit
stops at evidence collection and classification. Any mutation or migration
history decision remains a separately reviewed action.

## 2. Files changed

- `scripts/db/phase1c4-adoption-core.mjs`
- `scripts/db/phase1c4-adoption-audit.mjs`
- `tests/unit/phase1c4-adoption-readiness.test.ts`
- `docs/EXISTING_DATABASE_ADOPTION.md`
- `docs/INDEPENDENT_RUNTIME.md`
- `docs/PHASE1C4_EXISTING_DATABASE_ADOPTION_REPORT.md`
- `package.json`

No Prisma schema or migration SQL file was changed.

## 3. Safety controls

The executable audit requires both:

- `MELDSTOCK_DB_ADOPTION_AUDIT=1`
- an explicit PostgreSQL URL for
  `localhost:5432/meldstock_phase1c4`, limited to the `public` schema

The target validator rejects remote hosts, other ports, other database names,
other schemas, extra connection parameters, missing URLs, and missing opt-in
flags before a Prisma client is constructed.

The audit runs in a repeatable-read transaction and executes
`SET TRANSACTION READ ONLY` before catalog inspection. It reads only PostgreSQL
catalog metadata and `_prisma_migrations`; it does not query application rows or
print the connection string.

The repository intentionally provides no Phase 1C.4 command for:

- `prisma migrate deploy`
- `prisma migrate resolve`
- `prisma db push`
- DDL or DML against an existing database
- production or remote database access

## 4. Accepted inventory

The classifier pins the accepted Phase 1C.3 baseline at:

- 20 physical tables
- 18 PostgreSQL enums
- 4 committed migrations

For each migration record it also checks the committed migration SQL checksum,
completion state, rollback state, and applied-step count.

The generated JSON inventory includes table names, enum values and ordering,
column types and defaults, constraint definitions, index definitions, and
Prisma migration records. This is enough to support a later object-by-object
review without reading marketplace or authentication rows.

## 5. Classification model

The audit returns one of four states:

- `EMPTY_DATABASE`
- `ALREADY_MANAGED_CURRENT`
- `UNMANAGED_COMPLETE_REVIEW_REQUIRED`
- `PARTIAL_OR_DIVERGENT_REVIEW_REQUIRED`

Only an empty dedicated target or an already-managed exact match exits with
code `0`. Unmanaged or divergent states exit with code `2` as an intentional
stop signal.

Classification never grants permission to mutate a database. The runbook
requires an authorized isolated clone, an external backup or snapshot, manual
object-by-object review, and a separately approved forward-only plan before any
future adoption action.

## 6. Verification results

Repository verification produced the following results:

### Focused Phase 1C.4 tests

- Result: PASS
- Test files: 1 passed
- Tests: 4 passed
- Coverage: accepted object counts, explicit local-target gate, all four
  classification states, stop exit codes, read-only transaction marker, and
  absence of migration or schema-mutation commands

### Full test suite

- Result: PASS
- Test files: 24 passed, 1 skipped
- Tests: 192 passed, 1 skipped
- The skipped test is the existing explicitly gated Phase 1C.3 database smoke
  test; no disposable PostgreSQL URL was supplied to this workspace.

### TypeScript

- Result: accepted baseline failure only
- Exactly 16 pre-existing diagnostics remain in
  `tests/unit/audit.test.ts` and `tests/unit/thread-digest.test.ts`
- No Phase 1C.4 TypeScript diagnostic was introduced

### Lint

- Result: PASS
- Exactly five accepted warnings remain in `jobs/stale-nudge.js`
- No Phase 1C.4 lint warning or error was introduced

### Prisma validation

- Result: PASS
- Prisma version: `6.19.3`
- Output: `The schemas at prisma/schema are valid 🚀`

### Build

- Result: PASS
- Command: `SKIP_ENV_VALIDATION=1 next build`
- Next.js compiled, type-checked, generated static pages, and finalized the
  production build successfully

### Diff integrity

- `git diff --check`: PASS

## 7. Environment limitation

This workspace did not provide Docker or a disposable PostgreSQL server.
Accordingly, no live existing-database audit was executed and no database-backed
claim is made for Phase 1C.4.

That is the intended stop boundary: running the audit requires a database owner
to create an authorized backup or snapshot and restore an isolated local clone
under the exact dedicated database name. The audit must not be pointed directly
at production to compensate for a missing disposable environment.

## 8. Next controlled action

When an authorized isolated clone is available, run the command in
`docs/EXISTING_DATABASE_ADOPTION.md` and review the JSON outside the repository.

- If the state is `ALREADY_MANAGED_CURRENT`, no adoption marking is necessary.
- If the state is unmanaged or divergent, stop and prepare a reviewed,
  object-by-object, forward-only reconciliation proposal on another disposable
  clone.

No deployment, production access, migration application, migration resolution,
or new product phase should begin from this report alone.

## Summary

Phase 1C.4 adoption readiness is complete at the repository level. Meldstock now
has a fail-closed, read-only, local-clone inventory workflow and a documented
review gate for existing databases, while preserving the accepted Phase 1C.3
migration history unchanged.
