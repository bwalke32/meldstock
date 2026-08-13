# Meldstock — Technical Handoff to Codex

## Current application
Exported from Polsia as a Next.js application. The reviewed source contains roughly 287 TS/TSX files and about 42k lines across TypeScript/TSX/Prisma/tests.

### Confirmed core stack
- Next.js 16 App Router
- React 19
- TypeScript
- Tailwind CSS 4 + shadcn/Radix components
- Prisma 6
- PostgreSQL
- Better Auth
- Zod
- Vitest
- Biome
- XLSX parsing/import

### Existing product areas found in source
- signup/login/profile
- profile verification workflow
- broker profiles/connections/private network
- HAVE and WANTED lots
- trading floor and lot browse/detail
- resin abbreviation/normalization logic
- CSV/XLSX inventory upload wizard
- saved searches
- dashboard live market and matches
- messaging, group threads, attachments
- listing documents
- RFQ/WANTED responses
- offers/counteroffers/accept/decline/withdraw
- transaction/deal-status progression
- ratings
- notifications
- stale inventory lifecycle/nudge job
- audit/security helpers and tests

## Known Polsia dependencies to replace
Source review found direct dependencies on:
- Polsia AI proxy (`POLSIA_AI_BASE_URL`, `POLSIA_API_KEY`/token)
- Polsia email proxy (`POLSIA_EMAIL_PROXY_URL`)
- Polsia R2 upload proxy (`https://polsia.com/api/proxy/r2/upload`)
- Polsia analytics component/API
- Polsia deployment manifest (`polsia.toml`)
- Polsia-provisioned Postgres `DATABASE_URL`
- Polsia cron configuration for `jobs/stale-nudge.js`
- Polsia trusted auth domains and `@polsia.app` contact links

Goal: local development and future deployment must not require Polsia.

## Environment variables currently referenced
Observed source references include:
- DATABASE_URL
- BETTER_AUTH_SECRET
- BETTER_AUTH_URL
- BETTER_AUTH_TRUSTED_ORIGINS
- NEXT_PUBLIC_APP_URL
- NEXT_PUBLIC_API_URL
- POLSIA_OWNER_EMAIL
- POLSIA_EMAIL_PROXY_URL
- POLSIA_API_KEY
- POLSIA_AI_BASE_URL
- POLSIA_API_TOKEN
- POLSIA_ANALYTICS_SLUG
- POLSIA_API_BASE_URL
- SEO_INDEXABLE
- SKIP_ENV_VALIDATION

Do not request or print secret values. Build a new safe `.env.example` for the independent app after provider choices are made.

## Known critical findings from source review

### 1. Listing creation ownership/auth
`src/app/api/lots/route.ts` explicitly preserved anonymous posting for legacy/demo behavior. Review showed the route can use a client-provided `postedByUserId` when creating a lot. This must be corrected before beta: require authentication and derive owner identity only from the server session.

### 2. AI endpoint
`src/app/api/ai/chat/route.ts` must be reviewed for authentication/rate limiting before any metered external AI provider is connected.

### 3. Polsia storage coupling
Attachment/document upload routes directly call the Polsia R2 proxy. Replace with an object-storage adapter and enforce authorized download behavior.

### 4. Deployment/database safety
`polsia.toml` starts production with `prisma db push --accept-data-loss`. Do not carry that into independent production hosting. Move to committed Prisma migrations.

### 5. Demo/public market content
The public landing experience contains hard-coded/demo market content and claims that may not represent actual live data. Demo content must be labeled or replaced with database-backed real data before public beta.

### 6. Seed accuracy
Demo resin data requires technical review. One observed example associated SABIC Lexan 141R with PET; Lexan 141R is a polycarbonate grade. Do not seed technically incorrect plastics examples.

### 7. Polymer taxonomy gaps
Current `Polymer` enum includes ABS, PC, PP, PE variants, PA6/66/612, PBT, PET, POM, PPS, TPU, TPV, TPE, HIPS, GPPS, OTHER. Important product families such as PC/ABS, PC/PBT, PPO/PPE, and PEI are not first-class enum values yet.

### 8. Advanced material properties
Some advanced search concepts appear to live in notes/client filtering rather than structured database fields. Before large amounts of real inventory are loaded, propose a structured material-spec model/migration.

### 9. Company model
Current profile schema stores `companyName` and role data on an individual Profile. There is not yet a robust first-class Company/CompanyMember architecture. Evaluate and propose before broad multi-user company adoption.

### 10. Matching
Existing AI/matching functionality should be audited for scoring correctness and cost. Preferred direction: deterministic structured match first, AI-assisted equivalency/normalization/explanation second.

## Source files worth reading first
- `package.json`
- `AGENTS.polsia.md` (historical Polsia rules)
- `.polsia/installed.json`
- `.polsia/ownership.json`
- `polsia.toml`
- `src/lib/env.ts`
- `src/lib/auth.ts`
- `src/app/api/lots/route.ts`
- `src/app/api/ai/chat/route.ts`
- `src/app/api/attachments/upload/route.ts`
- `src/app/api/lots/[id]/documents/route.ts`
- `src/lib/ai/client.ts`
- `src/lib/email/send.ts`
- `src/lib/seed.ts`
- `src/lib/business/lot-visibility.ts`
- `src/lib/business/resin-normalize.ts`
- `src/lib/business/resin-abbreviations.ts`
- `prisma/schema/*.prisma`
- `tests/unit/*`

## First handoff milestone
Do not build new marketplace features yet. The first milestone is:

1. Repository understood and under Git.
2. Baseline checks documented.
3. Local development prerequisites documented.
4. Polsia dependencies mapped to provider-neutral adapters.
5. Critical auth/ownership risks identified with exact routes.
6. Migration plan written before broad code changes.
7. No real data loss and no committed secrets.

Once this milestone is reviewed, proceed with implementation in small phases.
