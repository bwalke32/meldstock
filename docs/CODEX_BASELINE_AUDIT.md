# Meldstock Baseline Audit

**Audit date:** 2026-08-13  
**Repository:** `C:\Users\BrandonWalker\Downloads\Meldstock\meldstock(1)`  
**Branch/commit:** `codex/polsia-handoff` at `ca96109` (`Preserve Polsia export baseline`)  
**Scope:** Read-only application audit. This document is the only intentional repository change.

## A. Executive summary

Meldstock is a substantial, buildable Next.js B2B thermoplastics trading application, not an empty prototype. The source contains persisted flows for profiles, HAVE/WANTED lots, inventory upload, visibility tiers, saved searches, private threads, RFQ responses, offers/counters, deal progression, ratings, notifications, and stale-listing nudges. The optimized Next.js build completes, Prisma validates, and all 138 existing Vitest tests pass.

It is **not ready for private beta or independent production deployment**. The top blockers are:

1. `POST /api/lots` allows anonymous commercial listing creation and accepts a client-supplied `postedByUserId`, enabling ownership spoofing.
2. `POST /api/ai/chat` is anonymous and has no application rate limit or quota guard, exposing a metered Polsia credential to abuse.
3. Thread messages accept any syntactically valid `attachmentUrl`; the authenticated download proxy later fetches that URL server-side. This is an SSRF path and does not prove that the attachment came from Meldstock storage.
4. The legacy lot-message route is readable and writable without authentication for public/anonymous lots even though the UI describes it as a private thread. Sender names are client supplied.
5. Any current thread participant can add another account to a commercial negotiation, which can disclose confidential messages and documents without seller/creator approval.
6. The “My network” model is unilateral but immediately treated as mutual. Any signed-in user can add another user and thereby satisfy network-based visibility checks without acceptance by the target.
7. Production startup runs `prisma db push --accept-data-loss`. The two committed migrations cover Better Auth only; marketplace schema creation is not reproducible through migrations.
8. AI, email, file upload, analytics, database provisioning, cron configuration, trusted auth domains, image hosts, and deployment are directly coupled to Polsia.
9. The homepage presents static lots, market counts, regional price signals, escrow, compliance, and reconciliation capabilities as live/real, although several are mock or unimplemented.
10. The plastics model is too shallow for dependable matching: many key properties exist only in notes, and PC/ABS, PC/PBT, PPO/PPE, and PEI are not first-class polymer values.

The safest first implementation phase is a narrow security-and-portability foundation: freeze/litigate all commercial trust boundaries, remove spoofable ownership and SSRF, introduce provider-neutral service interfaces with local-safe implementations, make seeding opt-in, and create a migration baseline before adding product features or changing the plastics schema.

## B. Current architecture

### Repository baseline

- Required handoff entries all exist: `AGENTS.md`, `CODEX_HANDOFF.md`, `FIRST_CODEX_PROMPT.txt`, `package.json`, `prisma/`, `src/`, and `tests/`.
- Git has one commit and was clean before this audit. No tags, CI configuration, container setup, or independent deployment configuration were found.
- Approximate inventory: 273 files under `src`, 66 API route files, 20 Prisma models, 17 Prisma enums, and 12 discovered Vitest files.
- Historical Polsia metadata remains in `.polsia/`, source banners, `AGENTS.polsia.md`, `polsia.toml`, and ownership tests.

### Actual technology stack

| Area | Current implementation |
|---|---|
| Frontend | Next.js 16.2.6 App Router, React 19.2.7, TypeScript 5.5, Tailwind CSS 4, Radix/shadcn-style components, React Hook Form, Zod |
| Backend | Next.js route handlers in `src/app/api/**/route.ts`; standalone Node cron in `jobs/stale-nudge.js` |
| Database | PostgreSQL through `DATABASE_URL` |
| ORM | Prisma 6.19.3 with multi-file schema in `prisma/schema/` |
| Authentication | Better Auth 1.6.25, email/password, Prisma adapter, database sessions, admin plugin |
| Authorization | Route-local `requireAuth`, admin-role checks, owner comparisons, visibility helper, and thread participant roster; policies are not centralized or uniformly safe |
| File storage | Direct upload to Polsia's R2 proxy; raw upstream URLs stored in PostgreSQL and proxied on download |
| Email | Direct POST to the Polsia email proxy from `sendEmail` and the stale-nudge job |
| AI/LLM | OpenAI-compatible Polsia AI proxy; generic streaming chat plus dashboard match ranking |
| Analytics | Polsia pixel beacon using a persistent browser UUID in `localStorage` |
| Scheduled jobs | Daily stale-listing nudge declared in `polsia.toml`, implemented as standalone Node/Prisma script |
| Deployment | Polsia manifest builds with npm and starts with unsafe Prisma `db push`; Polsia injects the database and platform variables |
| Testing/tooling | Vitest/jsdom unit tests, TypeScript strict mode, Biome; no browser E2E, integration database suite, CI, or coverage gate found |
| Inventory import | CSV/XLSX parsing with `xlsx`, preview/mapping/commit routes and UI |

### Environment-variable names observed

No values were inspected or recorded. A normal configuration references:

- Core/auth: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `BETTER_AUTH_TRUSTED_ORIGINS`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_API_URL`.
- Polsia runtime: `POLSIA_OWNER_EMAIL`, `POLSIA_EMAIL_PROXY_URL`, `POLSIA_API_KEY`, `POLSIA_API_TOKEN`, `POLSIA_AI_BASE_URL`, `POLSIA_ANALYTICS_SLUG`, `POLSIA_API_BASE_URL`, `POLSIA_IMAGE_REMOTE_HOSTS`.
- Build/SEO/runtime: `SEO_INDEXABLE`, `SKIP_ENV_VALIDATION`, `POLSIA_STATIC_CHECK`, `NODE_ENV`, `NEXT_RUNTIME`.

The typed environment schema makes these five variables mandatory for a normal build: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `POLSIA_EMAIL_PROXY_URL`, and `POLSIA_API_KEY`. This means local development is not currently Polsia-independent.

## C. What genuinely works

The following are supported by source inspection plus compilation/unit-test evidence, but were **not** exercised against a real database in an end-to-end environment:

- The application compiles into a production Next.js bundle with 66 API routes and the expected public/dashboard pages.
- Better Auth email/password plumbing, Prisma session storage, profile creation hook, and an auth route are present.
- Lot browse/detail, lifecycle, bulk import, saved searches, profiles, connections, dashboards, visibility filtering, and server-side owner checks exist.
- Authenticated message threads persist messages and participant rosters. Most thread read/write/download routes check participant membership.
- HAVE offers and WANTED responses persist immutable counter chains with party-derived IDs and action-specific permissions.
- Deal status, closeout status, ratings, notifications, and audit events are persisted.
- Lot document upload is owner checked; lot document download re-applies the listing visibility policy. Thread attachment download checks thread participation.
- The app has a deterministic resin normalization layer, a deterministic comparable-lot scorer, and an LLM-assisted dashboard ranking fallback.
- The daily stale-listing job has cooldown logic and stamps `lastNudgedAt` after successful email delivery.
- Existing unit tests pass (138/138), Prisma schema validation passes, and Biome completes without errors.

Important limitation: a page or route existing is not proof of a complete marketplace workflow. No current test demonstrates the required seller-to-buyer scenario across listing, match, message, document, offer, counter, acceptance, fulfillment, completion, and rating.

## D. Polsia dependencies

### Runtime dependencies

1. **AI proxy** — `src/lib/ai/client.ts` calls `${POLSIA_AI_BASE_URL}/chat/completions` with `POLSIA_API_KEY`/`POLSIA_API_TOKEN`. Default base is `https://polsia.com/ai/openai/v1`.
2. **Email proxy** — `src/lib/email/send.ts` and `jobs/stale-nudge.js` call `POLSIA_EMAIL_PROXY_URL` using `POLSIA_API_KEY`.
3. **R2/file proxy** — attachment and lot-document upload routes hard-code `https://polsia.com/api/proxy/r2/upload` and use `POLSIA_API_KEY`.
4. **Analytics** — `src/components/polsia-analytics.tsx` sends a page-load pixel to a Polsia base using `POLSIA_ANALYTICS_SLUG`; it stores `polsia_vid` in browser local storage.
5. **Database provisioning** — `polsia.toml` resolves `DATABASE_URL` from Polsia's `rdbms` capability.
6. **Scheduled jobs** — the stale-nudge schedule is a Polsia `[[crons]]` declaration.
7. **Deployment** — `polsia.toml` is the only deployment manifest and defines build, startup, port, health check, DB injection, and cron execution.
8. **Auth domains/admin bootstrap** — Better Auth unconditionally trusts `https://*.polsia.app` and `https://*.polsia.io`; `POLSIA_OWNER_EMAIL` grants the matching signup an admin role.
9. **Image configuration** — `POLSIA_IMAGE_REMOTE_HOSTS` is injected into Next image remote patterns.

### Product/configuration coupling

- Homepage and profile UI link to `meldstock@polsia.app` and display `meldstock.polsia.app` URLs.
- Package name/description, README, license attribution, source ownership banners, `.polsia` metadata, and ownership tests are Polsia-template-specific.
- The build has Polsia-only bypasses (`POLSIA_STATIC_CHECK`, `SKIP_ENV_VALIDATION`).
- No provider-neutral interfaces exist for AI, mail, storage, analytics, or scheduling.

## E. Critical security issues

### E1. Commercial listing ownership spoofing — CRITICAL

`CreateLot` accepts `postedByUserId`, and `POST /api/lots` resolves ownership as:

```ts
const postedByUserId = data.postedByUserId ?? session?.user?.id ?? null;
```

The body value wins even when a different user is authenticated. An anonymous caller can create a lot owned by any guessed user ID; an authenticated caller can also assign another user's ID. Because later update/lifecycle/document actions trust the stored owner, this is a foundational authorization failure.

Required correction: require a valid session for every commercial lot mutation; remove `postedByUserId` and identity fields from client write contracts; derive owner and safe display data from the session/profile only.

### E2. Anonymous metered AI relay — CRITICAL

`POST /api/ai/chat` validates message shape but performs no authentication, per-user quota, IP rate limit, cost ceiling, or task/model allow-list beyond the generic contract. Any caller can spend the server-side Polsia AI credential.

### E3. Arbitrary attachment URL / SSRF — CRITICAL

`CreateMessage` accepts `attachmentUrl: z.string().url()`. The thread message route stores it without proving it came from the upload route. The attachment download route later calls server-side `nodeFetch(msg.attachmentUrl)`. A participant can submit an internal, loopback, metadata-service, or attacker-controlled URL and cause the application server to fetch it. The proxy also buffers the entire response and reflects its content as a download.

Required correction: upload through a server-owned storage adapter, persist an opaque storage key and ownership binding, never accept a raw storage URL from the client, and make downloads resolve only allow-listed provider keys.

### E4. “Private” legacy lot messages are public — CRITICAL

`GET/POST /api/lots/[id]/messages` allows anonymous access whenever the lot visibility helper admits an anonymous viewer (PUBLIC and ANONYMOUS listings). It persists a client-supplied `senderName`, has no sender account identity, and returns the same shared message list to every viewer. UI copy calls this a “private thread,” creating a serious confidentiality mismatch. This channel is separate from the authenticated `MessageThread` system.

### E5. Participant-controlled disclosure of negotiation threads — CRITICAL

`POST /api/threads/[threadId]/participants` permits **any existing participant** to add an arbitrary account by email or unique company name. It does not require the seller, thread creator, admin, invite acceptance, or network/verification eligibility. The newly added user can read the whole thread and download its attachments. This is unsafe for broker confidentiality and deal terms.

### E6. Network visibility can be self-granted — CRITICAL

The `Connection` model has no pending/accepted state. `POST /api/connections` lets either user create a canonical pair immediately, and the application then treats it as mutual. A caller can add a target without consent and gain access to the target's `MY_NETWORK` listings. This invalidates the server-side visibility tier even though the visibility predicate itself is correctly centralized.

### Other authorization/privacy findings

- Lot visibility is enforced server-side for browse, detail, comparable, profile-lot, offer/response, and lot document paths; this is a strong existing foundation.
- Most authenticated thread routes correctly call `isThreadParticipant`; offer, RFQ response, saved search, lifecycle, rating, notification, and inventory routes generally derive acting IDs from the session.
- Lot document downloads allow unauthenticated access to documents on PUBLIC/ANONYMOUS listings because authorization follows listing visibility. If all COA/TDS/SDS files are intended to require an account or explicit deal participation, current behavior is too permissive.
- Upload MIME validation trusts the client-provided MIME type and buffers up to 50 MB in memory. There is no magic-byte validation, malware scanning, storage-key ownership record, or content-length enforcement on proxied downloads.
- Public profile output is identical to the full profile wire and includes phone, public email, social links, `isAdmin`, verification status, and timestamps. Some fields are intentionally public by name, but there is no field-level privacy control and `isAdmin` should not be exposed casually.
- Email/password authentication does not visibly require email verification. Business verification is a separate workflow.
- `Profile.isAdmin` duplicates Better Auth's `User.role`; current verification approval correctly checks `session.user.role`, but the duplicate field invites future authorization drift.
- Most cross-domain “foreign keys” are plain scalar IDs without database foreign-key constraints. Application authorization often handles them correctly, but orphaned/spoofed data is easier to create if any route regresses.

## F. High-priority technical issues

1. Replace unsafe startup schema synchronization with migrations and a separately invoked migration deploy step.
2. Add provider-neutral interfaces and configuration for mail, object storage, AI, analytics, and scheduled jobs.
3. Make local development possible without Polsia variables. Add a safe `.env.example` containing names/placeholders only after provider choices are made.
4. Make demo seeding explicit and off by default. Startup currently mutates any empty database and also performs a thread backfill on every boot.
5. Fix strict TypeScript errors in tests. `npm run typecheck` currently fails even though `next build` succeeds.
6. Declare `form-data` as a direct dependency if it remains directly imported; it currently appears to be relied on transitively.
7. Replace process-local rate limits and notification dedupe maps with a shared store before multi-instance deployment. Current protection resets per process and is inconsistent across replicas.
8. Remove or clearly quarantine `/api/example`, `/api/example-secure`, and `/example` from a production surface.
9. Add observability, structured logging, error reporting, health checks that include dependency readiness where appropriate, and operational runbooks.
10. Review transaction concurrency. Several action routes read state and then update; database-conditional writes/idempotency constraints should prevent simultaneous accept/counter/status races.

## G. Database/schema concerns

### Major models and relationships

| Domain | Models | Architecture |
|---|---|---|
| Auth | `User`, `Session`, `Account`, `Verification` | Better Auth owns relational auth tables |
| Profiles/company | `Profile`, `VerificationRequest` | One profile per `userId`; company name/type/role live on the individual profile; no Company or membership model |
| Inventory/listings | `Lot`, `LotMessage`, `Document` | HAVE/WANTED share one lot model; owner is nullable scalar `postedByUserId`; document and legacy messages link by scalar `lotId` |
| Network | `Connection` | Canonical user pair; instant mutual relationship; no request/accept state |
| Messaging/deals | `MessageThread`, `ThreadParticipant`, `ThreadReadState`, `Message` | Listing, RFQ, and broker-group threads; participant join; deal state is stored on the thread |
| Offers/RFQs | `Offer`, `WantedResponse` | Immutable parent/child counter chains; buyer/seller/thread/lot IDs mostly scalar |
| Transactions | No separate model | `MessageThread.status`, `dealStatus`, timestamps, buyer/seller and accepted offer/response collectively represent a deal; no order/payment/shipment ledger |
| Ratings | `Rating` | Five dimension rows per rater/thread, unique per dimension |
| Search/notifications | `SavedSearch`, `Notification` | Search filter stored as JSON; notification payload stored as JSON |
| Audit | `AuditEvent` | Append-only application log with redaction helper |
| AI matches | No model | Dashboard matches are computed per request and not persisted |

### Structural concerns

- Marketplace models use scalar IDs instead of Prisma/database relations to locked Better Auth models. This avoids generated back-relations but sacrifices referential integrity and cascading cleanup.
- `Document.lotId`, offer/response lot/thread/party IDs, notifications, ratings, verification requests, connections, and several audit links have no database FK.
- `accountType` is a free-form string while business role and verification state are enums.
- `hasCoa` is described in code as “at least one document,” not specifically a COA. Seed data can set it true without any `Document` row, so it is not a reliable fact.
- Saved-search filters and notification payloads are JSON without database-level shape/versioning.
- No first-class `Company`, `CompanyMember`, company inventory owner, company role, or invitation model exists. Multi-user company behavior cannot be made reliable by reusing `Profile.companyName`.
- No dedicated transaction, shipment, payment/escrow, PO, document-access grant, or lot/batch model exists despite UI/copy implying parts of those workflows.

### Migration safety

- `polsia.toml` starts production with `npx prisma db push --skip-generate --accept-data-loss && npm start`.
- Only two migrations are committed: initial Better Auth tables and Better Auth admin columns.
- None of the marketplace tables/enums are represented in committed migrations.
- A migration baseline must be designed against a schema-only copy or sanitized structure, never by running destructive commands against production. Production data must not be exported into the repository.

## H. Plastics data-model concerns

### Current field representation

| Material concept | Current representation | Truly structured? |
|---|---|---|
| Polymer | `Lot.polymer` Prisma enum | Yes, but taxonomy is incomplete |
| Manufacturer | Nullable string | Column, not normalized/reference data |
| Grade | Nullable string | Column, free text |
| Condition | `LotCondition` enum | Yes |
| Form | Required string | Column, free text |
| Color | Required string | Column, free text with limited normalization |
| Quantity | `quantityLb`, `quantityRemaining` Decimal | Yes, but hard-coded to pounds |
| Units | Implied pounds in field names; offers add `PER_LB`/`PER_KG` price unit | No general quantity-unit model |
| Price | `askingPricePerLb` Decimal | Column, fixed per-pound semantics; no currency |
| Location | Free-text `location` and `country` strings | Columns, not normalized |
| Packaging | Required string; response override string | Column, free text |
| MFR/MFI | Parsed into client filter intent, then searched against numbers in `notes` | No |
| MVR | Notes/free text only | No |
| Glass fiber % | Parsed/search UI, then notes heuristic | No |
| Carbon fiber % | Notes/free text only | No |
| Mineral/talc % | Combined glass/mineral UI heuristic over notes | No |
| Flame rating | Parsed/search UI, then notes substring | No |
| Recycled content | Condition enum plus notes | No percentage or PCR/PIR structure |
| FDA/food contact | Notes/cert text only | No |
| UV stabilization | Notes/free text only | No |
| Impact modification | Notes/free text only | No |
| COA/TDS/SDS | `DocumentType` enum and `Document` rows; PDF only | Document type is structured; claims/access metadata are limited |

The advanced filter implementation extracts the **first number from the entire notes string** for MFR, glass/mineral, and recycled-content comparisons. A note containing several values can therefore satisfy the wrong filter. These filters are also applied only after a capped server result set reaches the client, so results and saved-search counts can be incomplete or inconsistent.

### Polymer taxonomy gaps

The enum includes ABS, PC, PP, HDPE/LDPE/LLDPE, PA6/66/612, PBT, PET, POM, PPS, TPU, TPV, TPE, HIPS, GPPS, and OTHER. It does not include PC/ABS, PC/PBT, PPO/PPE, or PEI.

The shorthand parser tokenizes `PC/ABS` into both PC and ABS for search, but a single persisted `Lot.polymer` cannot represent the blend. When the dropdown is OTHER and multiple polymers are inferred, the write resolver does not promote one and the row remains OTHER. PC/PBT has the same structural problem; PPO/PPE and PEI lack canonical aliases/enums and fall to OTHER/free text.

Before changing the schema, write a compatibility proposal covering existing enum values, blend/family representation, units, structured property ranges, nullability/backfill, API wire compatibility, saved-search JSON migration, and indexing.

## I. AI matching concerns

### Deterministic matching

- Lot browse uses database filters for type, polymer, condition, form, grade/color text, free text, COA flag, quantity, and location.
- Advanced properties (MFR, glass/mineral, recycled %, flame, certs) are client-side note heuristics.
- Comparable lots prefilter on the same polymer, grade equivalence, and broad quantity bands, then score grade (+1), quantity band (up to +1), same continent (+1), and location-prefix match (+1).
- Grade equivalence accepts normalized exact strings, a stripped trailing letter, or the same leading letters plus four-digit token. It ignores manufacturer, condition, color, reinforcement, flame, and most grade semantics.

### LLM matching

- `GET /api/dashboard/matches` gathers candidates from saved searches plus an opposite-type fallback, then makes a Polsia LLM call for up to 25 candidates on every request when candidates exist.
- The LLM supplies a 0..1 score and short reason. Its score is weighted 70%; the local score is weighted 30%.
- Failures fall back to local scoring, which is good availability behavior.
- Results are ephemeral and are not persisted as an AI-match model.

### Obvious scoring flaws

1. `heuristicScore` calls `gradesEquivalent(candidate.grade, candidate.grade)`, so any candidate with a grade awards itself the grade bonus; it never compares to user demand or inventory.
2. The region bonus is awarded merely because the candidate maps to any known continent, not because it matches the user's region.
3. The quantity bonus is awarded for any positive/nonzero band, not for compatible demand quantity.
4. Saved-search candidates can be same-side or otherwise inappropriate when the saved filter does not explicitly express the complementary lot type.
5. The buyer path counts the user's WANTED lots but does not load those WANTED specifications as scoring anchors; the LLM receives only up to five HAVE inventory rows.
6. Candidate queries do not consistently restrict lifecycle status to ACTIVE, so stale/sold/deactivated inventory can enter ranking.
7. Grade equivalence can create false positives across manufacturers and specifications. Stripping color deliberately treats different colors as comparable, which is unsuitable for strict match logic.
8. Candidate text is embedded in an LLM prompt without a robust prompt-injection boundary. Output IDs are checked against candidates only indirectly when mapped, and the response has hand-written runtime validation rather than a strict schema.

### Unnecessary LLM use

The route sends an LLM request even for facts already represented structurally (type, polymer, grade string, quantity band, country, and saved-search hit). Deterministic hard constraints and a transparent weighted score should rank most candidates first. LLM use should be limited to ambiguous grade equivalence, normalization not covered by reference data, or a user-facing explanation, with caching and explicit cost controls.

## J. Demo/placeholder functionality

### Automatic seed behavior

`src/instrumentation.ts` calls `seed()` on every Node server startup. The seed backfills RFQ IDs on every boot and inserts eight lots whenever the database has zero lots. There is no explicit demo flag, environment allow-list, or DEMO/SAMPLE marker on the rows.

Known seed problems include:

- SABIC Lexan 141R is stored as PET and REPROCESSED with “50% PCR, food-contact grade”; Lexan 141R is a polycarbonate grade, making this row materially incorrect.
- Seed rows set `hasCoa: true` without creating corresponding `Document` records.
- Other manufacturer/grade/property combinations (for example LG Chem/Lustran 433 and the stated reinforcement of Ultramid A27E) require expert validation before reuse.
- Invented company/desk names and market terms are not labeled as sample data.

### Hard-coded public claims

The homepage defines a static `LOTS` array and static regional price-premium series, while presenting them as a live market. Examples include:

- “Updated every 4 min · 42 listings in 6 regions right now”
- “42 active · 7 pending · 3 closed today”
- fixed “comparables: 14” values
- hard-coded US Gulf/EU North/MX Border/APEC price movements and market commentary

It also claims workflows/data that do not exist as persisted functionality:

- escrow settlement and funds release;
- a separate recycled-content field with PCR/PIR split and chain-of-custody registry;
- post-trade reconciliation exports and filing-ready compliance data;
- complete compliance association/flags;
- “every listing” carrying structured origin, recycled content, and compliance.

Several static lots link to a Polsia email address instead of real lot records. These sections must be labeled DEMO/SAMPLE or replaced with truthful database-backed/implemented functionality before public beta.

## K. Test/build results

Commands were non-destructive and did not connect to a database.

| Check | Result |
|---|---|
| `git status --short --branch` | Clean at start on `codex/polsia-handoff`; one baseline commit |
| `node --version` | `v24.19.0` (project requires `>=20.18.1`) |
| `npm --version` | `11.17.0` |
| `npm ci` | Did not complete cleanly in the audit sandbox: first attempt failed with registry/cache `EACCES`; approved retry stalled and was terminated. It populated enough locked dependencies for all subsequent checks, but clean-install reproducibility remains unproven in this environment. |
| `npm test` | PASS: 12 files, 138 tests |
| `npx prisma validate` | PASS using a non-secret dummy local PostgreSQL URL; no database connection/mutation |
| `npm run lint` | PASS with 5 warnings, all in `jobs/stale-nudge.js` (console usage and one optional-chain suggestion) |
| `npm run typecheck` | FAIL: 16 strict-null errors in `tests/unit/audit.test.ts` and `tests/unit/thread-digest.test.ts` |
| `SKIP_ENV_VALIDATION=1 npm run build` | PASS: compiled and generated routes. Build emitted repeated Better Auth warnings/errors because auth URL/secret were intentionally absent/bypassed. |

The build bypass does not prove a correctly configured runtime. No local PostgreSQL instance or secret values were requested, and no server/database E2E verification was attempted.

## L. Missing infrastructure

- Independent deployment manifest/runtime architecture.
- Safe `.env.example` and documented local setup that does not require Polsia.
- Reproducible local PostgreSQL setup (container or documented external instance).
- Marketplace schema migration history and migration deployment procedure.
- Provider-neutral email, storage, AI, analytics, and scheduler adapters.
- Local storage/email/AI no-op or emulator implementations.
- CI for install, Prisma validate/generate, lint, typecheck, unit, integration, build, secret scanning, and dependency audit.
- Integration-test database and route-level auth fixtures.
- Browser E2E tests for the core trade lifecycle.
- Centralized authorization policy tests and a documented access matrix.
- Durable/distributed rate limiting, queues/deduplication, and job observability.
- Backup/restore, retention/deletion, privacy, document lifecycle, and incident-response plans.
- Error monitoring, structured logs, metrics, alerting, and audit-log review tooling.
- First-class company/membership architecture proposal.
- Truthful demo-data controls and environment separation.

## M. Recommended migration path away from Polsia

1. **Freeze the baseline.** Preserve the current commit, record this audit, and avoid production data access during migration design.
2. **Close trust-boundary defects first.** Require auth for listings, derive ownership from session, disable or secure anonymous lot messages, close the attachment SSRF path, gate AI, restrict thread invitations, and replace unilateral network semantics.
3. **Define provider-neutral interfaces.** Create narrow server-only contracts for `MailService`, `ObjectStorage`, `AiService`, `Analytics`, and scheduled-job execution. Preserve current behavior behind temporary Polsia implementations while adding local-safe/no-op implementations.
4. **Make configuration independent.** Remove mandatory Polsia variables from core startup, document variable names in `.env.example`, and replace Polsia domains/admin bootstrap with explicit application configuration.
5. **Establish migration discipline.** Generate/review a marketplace schema baseline without touching production, reconcile it with the two auth migrations, test against a disposable database, then use `prisma migrate deploy` as a separate release step. Never use `db push --accept-data-loss` in production.
6. **Make seed data opt-in.** Separate schema/data backfills from demo seeding. Add an explicit local/demo command and label all rows SAMPLE/DEMO or use a dedicated demo environment.
7. **Add independent operational services.** Select PostgreSQL, S3-compatible private object storage with signed/authorized access, transactional email, scheduler, and optional AI/analytics providers based on requirements. Do not couple domain logic to those providers.
8. **Add security integration and E2E tests.** Prove negative authorization cases and the full seller/buyer lifecycle before private beta.
9. **Only then propose plastics/company schema migrations.** Document compatibility, backfill, API, indexing, and rollout before changing production schema.

## N. Prioritized work

### CRITICAL

- Require authentication on commercial listing creation; delete client ownership IDs and derive owner/name from the session/profile.
- Disable or redesign the legacy anonymous/public lot-message channel so private negotiation claims are true.
- Remove raw client attachment URLs and close the SSRF path; bind uploads to user/thread/storage keys.
- Authenticate and rate/quota-limit the AI endpoint; restrict task/model usage.
- Restrict participant additions to an authorized role/explicit invitation workflow; test history/document confidentiality.
- Replace unilateral instant-mutual connections with request/accept semantics, or stop using them as a confidentiality boundary.
- Remove `db push --accept-data-loss` from production startup and establish reviewed migrations.
- Disable automatic unlabeled seed insertion outside explicit local/demo environments.
- Add route-level security tests for all above cases.

### BEFORE PRIVATE BETA

- Introduce provider-neutral AI/mail/storage/analytics/job interfaces and independent local configuration.
- Validate file signatures, enforce safe sizes while streaming, scan uploads, use opaque keys, and authorize every download.
- Decide whether public listing documents require authentication, listing visibility, or deal participation; encode and test the policy.
- Fix TypeScript errors and add clean-install/CI verification.
- Add integration tests for lots, visibility, messages, offers, RFQs, transactions, ratings, connections, notifications, and admin verification.
- Make homepage/seed content truthful and clearly label all demo/sample data.
- Remove claims for escrow, compliance exports, structured PCR/PIR, and live market indexes until implemented.
- Create local PostgreSQL setup, migration runbook, backups, logs, monitoring, and a scheduler runbook.
- Review all public profile fields and add field-level privacy decisions.
- Add conditional/idempotent database mutations for negotiation and state-transition races.
- Produce (but do not yet casually implement) plastics-model and Company/CompanyMember migration proposals.

### AFTER PRIVATE BETA

- Implement approved first-class Company/CompanyMember ownership and permissions.
- Implement approved structured materials/spec model with units, ranges, blend families, lot/batch data, and certification claims.
- Replace notes-based advanced filtering with indexed deterministic queries.
- Improve explainable deterministic matching and use AI only for ambiguity/equivalency/explanation.
- Add admin moderation, audit review, data export/deletion, retention controls, and beta support tooling.
- Add durable queues/deduplication and distributed rate limiting for multi-instance deployment.

### FUTURE

- Verified manufacturer/grade equivalency reference data and expert-governed taxonomy.
- Market intelligence only after enough real, consented, anonymized transactions exist; never fabricate indices.
- Real shipment/PO/payment/escrow integrations with legal/compliance review.
- Advanced broker/company permissions, delegated inventory, approvals, and enterprise SSO.
- Reporting and regulatory exports only after the underlying structured data and validation controls exist.

## O. Recommended first implementation phase

**Phase 1: Security and independent-runtime foundation (small reviewable slices, no product expansion).**

Proposed order:

1. Add failing authorization tests for listing ownership, AI anonymity, attachment URL injection, public lot messages, thread invitations, and network visibility.
2. Require authenticated listing creation and derive all ownership/display identity server-side.
3. Replace attachment URL input with a server-issued opaque upload token/storage key; enforce thread binding and safe download resolution.
4. Remove or authenticate the legacy lot-message flow, migrating the UI to `MessageThread` where a seller identity exists. Define a truthful, limited contact workflow for genuinely anonymous listings.
5. Gate AI behind auth plus rate/quota controls and disable it cleanly when no provider is configured.
6. Lock commercial thread invitations to an explicit policy and stop treating self-created connection pairs as accepted mutual relationships.
7. Introduce provider-neutral interfaces with temporary Polsia adapters and local no-op/filesystem-safe implementations; do not change business workflows broadly.
8. Make seed/demo behavior explicit and non-production.
9. Create and test a reviewed Prisma migration baseline on a disposable local database; change deployment to `prisma migrate deploy` only after review.
10. Add CI and the core end-to-end seller/buyer scenario before declaring Phase 1 complete.

Phase 1 should not include a broad UI rewrite, a Company schema rollout, plastics schema expansion, matching redesign, deployment to production, or new marketplace features. Those require separate proposals after the trust boundaries and reproducible baseline are stable.
