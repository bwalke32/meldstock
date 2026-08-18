# Meldstock Independent Runtime Contract

This is the active runtime contract for Meldstock. Historical Polsia deployment
metadata is provenance only and is not an approved build, migration, startup, or
scheduling path. No permanent production vendor is selected by this document.

## Application

- Node.js `>=20.18.1` and npm are required; the committed lockfile is authoritative.
- Install: `npm ci`
- Generate Prisma Client: `npm run db:generate`
- Validate schema/config: `npm run db:validate`
- Build: `npm run build` (or `SKIP_ENV_VALIDATION=1 npm run build` only for an
  intentionally envless compile check)
- Start: `npm start`; schema migration is a separate operator step and startup
  never modifies the database.
- Development server: `npm run dev`
- Health/readiness endpoint: `GET /health`, returning `{"status":"healthy"}`.
  It proves the web process responds, not that every provider or database query works.

Set `PORT` when the runtime does not provide its own default. A reverse proxy or
platform should terminate TLS and forward the original host/protocol correctly.

## PostgreSQL and Prisma

Meldstock requires PostgreSQL and a PostgreSQL `DATABASE_URL`. Prisma 6.19.3 is
pinned in the repository. The independent release sequence is:

```bash
npm ci
npm run db:generate
npm run db:validate
npm run db:migrate:deploy
npm run build
npm start
```

`npm run db:migrate:deploy` runs `prisma migrate deploy`. Never substitute a
schema-push workflow in a shared, staging, or production environment.

Important Phase 1C.2 limitation: committed migrations currently create Better
Auth tables and the isolated Connection shape only. They do not yet create the
complete marketplace schema. Phase 1C.3 must create and verify the reviewed
baseline before a brand-new database can run the complete app. Until then, a
fresh disposable database is useful for validating current migration history,
but full data-backed application workflows require an existing compatible
development database. Do not point local setup at production to work around this.

## Authentication

- `BETTER_AUTH_SECRET`: required server secret. Generate a long random value for
  each environment; never commit it.
- `BETTER_AUTH_URL`: canonical public origin, such as `http://localhost:3000`.
- `BETTER_AUTH_TRUSTED_ORIGINS`: optional comma-separated additional exact origins.
  No Polsia domains are trusted implicitly.
- `MELDSTOCK_BOOTSTRAP_ADMIN_EMAIL`: optional. When set before that address first
  registers, the Better Auth create hook assigns the `admin` role. It does not
  promote an already-created account and should be blank for ordinary local use.

`NEXT_PUBLIC_APP_URL` should match the browser-visible application origin.
`NEXT_PUBLIC_API_URL` should normally remain empty for same-origin API calls.

## Provider selection

The safe local defaults require no Polsia credentials:

| Capability | Selector | Safe default | Runtime behavior |
|---|---|---|---|
| Mail | `MAIL_PROVIDER` | `local` | Discards mail without logging recipient/body data |
| Storage | `STORAGE_PROVIDER` | `local` | Private files under `LOCAL_STORAGE_PATH` (`.data/objects`) |
| AI | `AI_PROVIDER` | `disabled` | No metered/network AI; deterministic fallback remains |
| Analytics | `ANALYTICS_PROVIDER` | `disabled` | No-op; sends no analytics request |
| Scheduler | `SCHEDULER_PROVIDER` | `manual` | No in-process schedule |

The temporary `polsia` adapter values exist only for controlled compatibility
and do not make Polsia an approved deployment path. If legacy storage reads are
explicitly enabled, `POLSIA_LEGACY_STORAGE_ORIGINS` must be a comma-separated
allowlist of exact HTTPS origins known to have hosted historical Meldstock
objects. An arbitrary URL is never a valid object reference.

## Scheduled stale-inventory nudge

Run one idempotent invocation with:

```bash
npm run job:stale-nudge
```

A future provider-neutral external scheduler may invoke that command (suggested
cadence `0 9 * * *`) with `DATABASE_URL`, `NEXT_PUBLIC_APP_URL`, and the chosen
mail configuration. Do not run it from an in-process timer. The local mail
provider sends nothing.

## GitHub/Codespaces local reproduction

1. Clone the repository and run `npm ci`.
2. Copy `.env.example` to `.env` and replace the example auth secret with a
   local-only random value. Keep mail/storage/AI/analytics/scheduler on their safe
   defaults and keep `ENABLE_DEMO_SEED=0`.
3. Start disposable PostgreSQL 16. A Codespaces-compatible example, if Docker is
   available, is:

   ```bash
   docker run --rm --name meldstock-postgres \
     -e POSTGRES_USER=meldstock \
     -e POSTGRES_PASSWORD=meldstock \
     -e POSTGRES_DB=meldstock \
     -p 5432:5432 postgres:16-alpine
   ```

   This is disposable development data only. Do not reuse real credentials or
   load production exports. Stop the container when finished.
4. Run `npm run db:generate`, `npm run db:validate`, `npm test`,
   `npm run typecheck`, and `npm run lint`.
5. Run `SKIP_ENV_VALIDATION=1 npm run build` for the repository compile check.
6. Run `npm run db:migrate:deploy` only against the disposable database, with the
   incomplete-baseline limitation above understood.
7. Run `npm start` (or `npm run dev`) and check `http://localhost:3000/health`.

The core web process can build and start without Polsia credentials. Complete
fresh-database marketplace workflows remain intentionally blocked on Phase 1C.3.
