# Meldstock Existing-Database Adoption Runbook

This runbook applies only to a separately managed PostgreSQL database that may
already contain Meldstock objects. It does not authorize production access,
deployment, data export, migration-history changes, or application of baseline
table-creation SQL.

The accepted fresh-database path is already proven: the four committed migrations
produce the complete 20-table, 18-enum Prisma schema on an empty PostgreSQL
database. An existing database is a different problem and must be treated as one.

## Safety boundary

1. A database owner creates a backup or snapshot using the database platform's
   approved process.
2. Restore only an authorized schema-only or isolated clone into a disposable
   local PostgreSQL database named `meldstock_phase1c4`.
3. Do not copy the clone, audit output, credentials, or row data into Git.
4. Run the audit only on `localhost` or `127.0.0.1`, port `5432`, database
   `meldstock_phase1c4`, and schema `public`.
5. Stop after classification. The repository intentionally provides no command
   that marks migrations as applied or modifies an existing database.

The audit starts a repeatable-read transaction and immediately sets it to
`READ ONLY`. It reads PostgreSQL catalog metadata for tables, enums, columns,
constraints, indexes, and Prisma migration records. It does not query application
rows or print the connection string.

## Run the isolated audit

From the repository root, after `npm ci` and `npm run db:generate`:

```bash
DATABASE_URL='postgresql://postgres:postgres@localhost:5432/meldstock_phase1c4?schema=public' \
  MELDSTOCK_DB_ADOPTION_AUDIT=1 \
  npm run db:adoption:audit > /tmp/meldstock-phase1c4-audit.json
```

Keep the JSON outside the repository. Review it before sharing because schema
names, defaults, and indexes can still reveal operational design even though no
row data is included.

An exit code of `2` is an intentional stop signal for a database that requires
review. It is not permission to bypass the check.

## Classification

| State | Meaning | Allowed next action |
| --- | --- | --- |
| `EMPTY_DATABASE` | No user tables, enums, or migration rows exist. | Use only the accepted fresh-database migration path in a disposable or newly approved environment. |
| `ALREADY_MANAGED_CURRENT` | All 20 tables, 18 enums, four migration records, completion state, and committed SQL checksums match. | Continue read-only status and drift checks; no adoption marking is needed. |
| `UNMANAGED_COMPLETE_REVIEW_REQUIRED` | Expected objects appear complete, but accepted Prisma history is absent. | Stop and compare every migration-owned object on the isolated clone before proposing any history marking. |
| `PARTIAL_OR_DIVERGENT_REVIEW_REQUIRED` | Tables, enums, migration records, checksums, or completion state differ. | Stop and write an object-by-object reconciliation plan. Do not apply the baseline blindly. |

## Required review for an unmanaged or divergent database

Review each migration separately:

1. `20260603000000_init_better_auth`: lowercase `user`, `session`, `account`,
   and `verification` tables, unique indexes, and cascading auth foreign keys.
2. `20260612000000_add_better_auth_admin`: admin fields on `user` and
   `impersonatedBy` on `session`.
3. `20260817000000_connection_request_accept`: `ConnectionStatus`, the
   `Connection` consent columns, canonical pair uniqueness, pending defaults,
   and the three status-aware indexes.
4. `20260825000000_marketplace_baseline`: the 15 marketplace tables, 17
   marketplace enums, defaults, constraints, self-relations, and indexes.

Object names alone are insufficient. Column types, nullability, defaults,
constraint definitions, enum ordering, index definitions, migration checksums,
and incomplete or rolled-back migration records must also agree.

If an isolated clone is not exact, create forward-only reconciliation SQL for
the specific differences and prove it on another disposable clone. Never edit
accepted migration files or their checksums. Any later proposal to mark a
migration as already applied requires separate review and explicit operator
approval; this phase does not perform that action.

## Final acceptance gate

Before an existing environment can be adopted, the evidence package must show:

- a recoverable backup or snapshot exists
- the audit was run against an isolated local clone, not production
- every expected table, enum, column, constraint, and index was reviewed
- the four committed migration checksums remain unchanged
- application row data was not exported into the repository
- the resulting migration plan is forward-only and repeatable
- a second disposable clone passes migration status, zero-drift comparison,
  database smoke tests, repository tests, typecheck baseline comparison, lint,
  build, and `git diff --check`

Until every item is satisfied, the correct action is to stop.
