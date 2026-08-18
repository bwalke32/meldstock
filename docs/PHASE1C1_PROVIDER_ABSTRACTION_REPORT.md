# Meldstock Phase 1C.1 Provider Abstraction Report

Date: 2026-08-17  
Branch: `codex/phase1c1-provider-abstraction`

## 1. Scope and outcome

This slice removes Polsia configuration from core startup and routes current mail, object storage, and AI use through narrow server-only services. Local mail/storage, disabled AI, and no-op analytics are the defaults. Existing Phase 1A/1B/1B.5 authorization gates remain in place. No deployment, production access, database schema change, permanent vendor selection, or feature redesign was performed.

## 2. Files changed

- Provider contracts/registry/adapters: `src/lib/services/{types,index,mail,storage,ai,analytics}.ts`
- Existing integration facades/routes: `src/lib/email/send.ts`, `src/lib/ai/client.ts`, attachment and listing-document upload/download routes
- Configuration/auth/runtime: `src/lib/env.ts`, `src/lib/auth.ts`, `next.config.ts`, `src/app/layout.tsx`, `.env.example`, `.gitignore`
- Startup/jobs: `src/instrumentation.ts`, `src/lib/seed.ts`, `jobs/stale-nudge.js`, `package.json`, `package-lock.json`
- Public runtime coupling: setup/profile/contact copy, navigation, auth-client comments
- Tests: `tests/unit/phase1c1-config.test.ts`, `tests/unit/phase1c1-providers.test.ts`, and focused updates to instrumentation/attachment regression tests

## 3. Provider interfaces created

- `MailService.send(message)`
- `ObjectStorage.put/get/delete`, returning an application-controlled opaque key separate from the original filename
- `AiService.complete/stream` over Meldstock-controlled request shapes; no new public generic relay was added
- `AnalyticsService.record(event)`

The registry is deliberately small and selected by environment configuration; it is not a plugin framework.

## 4. Temporary Polsia adapters retained

- `PolsiaMailService`
- `PolsiaObjectStorage`
- `PolsiaAiService`
- `PolsiaAnalyticsService`

Polsia adapters validate their required configuration only when selected. Business routes no longer contain Polsia upload URLs or credentials. The authenticated/rate-limited AI route still calls the existing AI facade, now backed by `AiService`.

## 5. Local/development implementations

- `LocalMailService` discards messages without sending or logging recipient/body data.
- `LocalObjectStorage` writes mode-restricted files under `.data/objects` by default (ignored by Git), uses random `local:v1:<uuid>` keys, never derives paths from filenames, and rejects URL/path input on reads.
- `DisabledAiService` reports AI unavailable while deterministic dashboard matching retains its existing fallback.
- `NoopAnalyticsService` makes no request.

Attachment tokens accept the new local opaque identity while retaining the Phase 1A encrypted, server-issued reference boundary. Both attachment and document downloads still authorize the user before calling storage.

## 6. Environment and configuration changes

Core validation now requires only `DATABASE_URL`, `BETTER_AUTH_SECRET`, and `BETTER_AUTH_URL`. Defaults are `MAIL_PROVIDER=local`, `STORAGE_PROVIDER=local`, `AI_PROVIDER=disabled`, `ANALYTICS_PROVIDER=disabled`, and `SCHEDULER_PROVIDER=manual`.

Provider-specific Polsia variables are optional globally and conditionally required for the selected adapter. `.env.example` groups safe placeholders under CORE, DATABASE, AUTH, MAIL, STORAGE, AI, ANALYTICS, and SCHEDULER. `IMAGE_REMOTE_HOSTS` replaces `POLSIA_IMAGE_REMOTE_HOSTS`.

## 7. Auth-domain and admin-bootstrap changes

Better Auth no longer automatically trusts `*.polsia.app` or `*.polsia.io`. Additional trusted origins come only from `BETTER_AUTH_TRUSTED_ORIGINS`; the configured base URL remains implicitly trusted by Better Auth.

`POLSIA_OWNER_EMAIL` was removed. Optional bootstrap administration now uses the explicit generic `MELDSTOCK_BOOTSTRAP_ADMIN_EMAIL` variable. Authentication and existing admin role checks were not weakened.

## 8. Scheduler/job changes

`runStaleNudge({ prisma, mail, now, appUrl })` contains independently invokable business logic with injected database and mail services. `npm run job:stale-nudge` is the normal CLI entry point. A future scheduler should execute that command with database, application URL, and chosen mail-provider configuration. The CLI defaults to a non-sending local mail sink.

The historical Polsia cron declaration remains in `polsia.toml` for provenance; it is not needed to invoke the job.

## 9. Seed/startup changes

Normal server startup performs no seed or backfill. `ENABLE_DEMO_SEED=1` is required before instrumentation imports and runs `seed()`. Seeded seller names are explicitly prefixed `SAMPLE —`. The existing WANTED-thread RFQ backfill remains inside the opt-in seed and no longer runs implicitly in ordinary environments.

## 10. Remaining direct Polsia dependencies

- `polsia.toml` remains historical deployment/cron configuration and still contains the unsafe legacy `db push --accept-data-loss` start command. It must not be used for independent deployment; database baseline work is deferred as instructed.
- `src/components/polsia-analytics.tsx` remains an unused historical component. Root layout no longer mounts it.
- `POLSIA_STATIC_CHECK` remains a build-only historical render-check switch.
- `@polsia:*` banners, `.polsia/**`, `AGENTS.polsia.md`, ownership tests, and template comments remain historical provenance.
- Temporary adapter variables and Polsia adapter classes remain intentionally available when explicitly selected.
- Existing database rows containing legacy HTTPS storage URLs require the Polsia storage adapter (or a future controlled migration) to download; local storage intentionally refuses arbitrary URLs.

No direct `polsia.com` upload, email, or AI URL remains in a business route.

## 11. Tests added

Focused tests prove zero-Polsia core validation; conditional Polsia mail requirements; no-network local mail; opaque local storage and attachment-token compatibility; disabled AI and no-op analytics; explicit auth origins and generic admin bootstrap; opt-in demo seed; and independently injectable stale-nudge logic. All prior security regression tests continue to pass.

## 12. Full verification results

| Check | Result |
|---|---|
| `npm test` with all `POLSIA_*` variables removed | PASS: 21 files, 183 tests |
| `npm run typecheck` | Expected baseline failure only: exactly 16 pre-existing strict test errors (15 in `audit.test.ts`, 1 in `thread-digest.test.ts`); no Phase 1C.1 errors |
| `npm run lint` | PASS with the same five pre-existing `jobs/stale-nudge.js` warnings |
| `npx prisma validate` | PASS with non-secret local placeholder `DATABASE_URL` |
| zero-Polsia `SKIP_ENV_VALIDATION=1 npm run build` | PASS outside sandbox after the expected Turbopack local-port restriction; compiled successfully and produced `.next/BUILD_ID` |
| local provider configuration | PASS through focused local mail/storage/disabled-AI/no-op-analytics tests |
| `git diff --check` | PASS |

No verification connected to production, deployed, ran `prisma db push`, or sent external mail.

## 13. Remaining limitations

- Local object storage is single-node filesystem storage, suitable for local/Codespaces development only.
- Polsia object deletion is not supported because the exported integration did not expose a safe delete contract.
- Analytics is disabled by default; the retained server adapter is not mounted until a reviewed analytics event surface is needed.
- The stale-nudge CLI is provider-selectable, but `polsia.toml` remains the historical schedule declaration.
- Full marketplace migration baseline, permanent providers, distributed storage, database-backed integration tests, and end-to-end workflow coverage remain future work.

## 14. Recommended Phase 1C.2

After review, use a separate small slice to quarantine the historical deployment manifest further, add provider contract integration tests around legacy-object migration behavior, and document independent deployment/database prerequisites. Do not combine it with permanent vendor selection or the full Prisma migration baseline.
