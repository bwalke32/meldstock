# Meldstock Phase 1A Security Report

Date: 2026-08-14  
Branch: `codex/phase1a-security`  
Baseline audit commit: `0ee354e Document Meldstock baseline audit`

## Scope and outcome

Phase 1A addressed only the three approved trust boundaries: commercial listing ownership, the metered AI chat endpoint, and thread attachments. No Prisma schema, migration, production data, deployment, provider migration, or unrelated product workflow was changed.

## A. Commercial listing ownership

### Security issue addressed

`POST /api/lots` permitted anonymous commercial listing creation and accepted `postedByUserId` and `postedByName` from the client. A caller could therefore create an ownerless listing or spoof another user's ownership and displayed identity.

### Previous behavior

- A session was optional.
- `postedByUserId` from JSON took precedence over the session user.
- `postedByName` was supplied by the browser.
- The CSV boundary also accepted `posted_by_name` as an optional input.

### New behavior

- `POST /api/lots` requires an authenticated session before validation or persistence.
- The strict public `CreateLot` write contract contains no ownership or posting-identity fields. Attempts to send the legacy fields are rejected rather than silently discarded.
- The server always stamps `postedByUserId` from `session.user.id` and resolves the displayed identity from trusted Profile/User records.
- Single-listing, CSV bulk, and inventory-upload paths no longer accept client-controlled posting identity. Bulk paths retain an internal server-only posting-name value after authentication.
- CSV files containing ownership/identity columns are explicitly rejected.
- `ANONYMOUS` remains a supported listing visibility. Its authenticated owner remains persisted while public responses continue to scrub the owner identity.
- Public read-only listing browsing remains available.

### Tests added

- Anonymous listing POST is rejected before a database write.
- JSON ownership/display-identity spoofing is rejected.
- CSV posting-identity input is rejected.
- An authenticated listing is persisted under the session user and trusted account identity.
- Anonymous public listing reads remain functional.

## B. AI chat boundary

### Security issue addressed

`POST /api/ai/chat` was an anonymous, broadly parameterized relay capable of consuming the server-side metered Polsia AI credential.

### Previous behavior

- No authentication.
- No application-level usage limit.
- Callers could select arbitrary non-empty model and task strings and submit system messages.
- Provider failures used separate responses but the public route lacked a deliberately narrow application contract.

### New behavior

- Authentication is required before request processing or provider access.
- An in-process per-user token bucket allows a burst of 8 requests and refills at 8 requests per minute.
- The input is capped at 20 messages, 4,000 characters per message, and 20,000 characters total.
- Client system messages are rejected. The server supplies the Meldstock-specific system instruction.
- Only `gpt-4o-mini` and the `meldstock-assistant` task are accepted/used; arbitrary relay parameters are rejected.
- Missing configuration returns generic `503 {"error":"ai_unavailable"}`. Other provider failures return the same generic error with status 502. Provider details and credentials are never copied into responses.

### Tests added

- Anonymous AI requests are denied before a provider call.
- Authenticated requests reach the protected provider path with the fixed model/task.
- The route returns 429 before provider access when limited.
- The dedicated AI token-bucket capacity is tested.
- Provider errors containing credential-like text are not exposed.

## C. Thread attachment SSRF

### Security issue addressed

The message contract accepted arbitrary `attachmentUrl` values. The authenticated download proxy later performed a server-side fetch of the persisted value, allowing a participant to target attacker-controlled, loopback, internal, or metadata-service URLs.

### Previous behavior

- A client could submit any syntactically valid URL with a message.
- Filename and MIME type were also client-controlled.
- The download route checked thread participation, then fetched the stored raw URL and followed the fetch implementation's normal redirect behavior.

### New behavior

- Uploads return a server-issued, AES-256-GCM authenticated opaque token instead of a raw provider URL.
- The token contains the upstream storage URL, uploader, filename, MIME type, and issue time; its encryption key is domain-separated from `BETTER_AUTH_SECRET`.
- Token issuance rejects non-HTTPS targets, credentials in URLs, localhost/local/internal names, and all IP-literal hosts, including loopback and metadata-service addresses.
- The strict message contract accepts only `attachmentToken`; raw URL, filename, and MIME fields are rejected.
- Message creation validates thread participation before resolving the token, verifies the token belongs to the current user, applies a one-hour binding window, and persists token-derived metadata.
- Downloads authorize the requester as a thread participant before resolving or reading storage.
- Only a valid Meldstock-issued token can produce an upstream read. Raw legacy URLs and forged tokens fail closed with 404 and are never fetched.
- Storage reads use `redirect: "error"`, preventing a controlled storage endpoint from redirecting the server to an internal target.
- Response filenames strip quote and newline characters before being placed in headers.

### Tests added

- Arbitrary HTTPS and loopback URL message inputs are rejected.
- Loopback and metadata-service targets cannot be tokenized.
- A valid server-issued token resolves only for its uploader.
- A valid token is persisted with server-derived metadata on message creation.
- A non-participant receives 403 before any storage fetch.
- An authorized participant can download through the approved storage path, with redirects disabled.

## Files changed

### Listing ownership

- `src/app/api/lots/route.ts`
- `src/app/api/lots/bulk/route.ts`
- `src/app/api/inventory/bulk-upload/commit/route.ts`
- `src/components/custom/post-a-lot-form.tsx`
- `src/components/custom/dashboard/inventory/csv-upload-client.tsx`
- `src/lib/business/posting-identity.ts`
- `src/lib/business/inventory-bulk-upload/validate.ts`
- `src/lib/contracts/lots.ts`
- `src/lib/csv/lots.ts`
- `tests/unit/phase1a-lots.test.ts`

### AI boundary

- `src/app/api/ai/chat/route.ts`
- `src/lib/ai/client.ts`
- `src/lib/ai/schema.ts`
- `src/lib/security/rate-limit.ts`
- `tests/unit/phase1a-ai.test.ts`
- `tests/unit/rate-limit.test.ts`

### Attachments

- `src/app/api/attachments/upload/route.ts`
- `src/app/api/threads/[threadId]/messages/route.ts`
- `src/app/api/threads/[threadId]/attachments/[msgId]/download/route.ts`
- `src/components/custom/messages/thread.tsx`
- `src/lib/contracts/messaging.ts`
- `src/lib/security/attachment-token.ts`
- `tests/unit/phase1a-attachments.test.ts`

## Verification results

- `npm test`: PASS — 15 files, 153 tests.
- `npm run typecheck`: EXPECTED BASELINE FAILURE — exactly the previously documented 16 strict TypeScript errors remain: 15 in `tests/unit/audit.test.ts` and 1 in `tests/unit/thread-digest.test.ts`. No Phase 1A source or new-test type errors were reported.
- `npm run lint`: PASS — exit code 0. Five pre-existing warnings remain in `jobs/stale-nudge.js`; no Phase 1A lint errors or warnings.
- `npx prisma validate`: the literal command first reported missing `DATABASE_URL`. Re-run with a non-secret, non-routable local validation URL (`postgresql://localhost:5432/meldstock_validation`) passed. Prisma validation does not connect to the database, and no schema was changed.
- `SKIP_ENV_VALIDATION=1 npm run build`: PASS using the PowerShell-equivalent environment assignment. Next.js compiled, type-checked application code, and generated pages successfully. It emitted expected warnings because `BETTER_AUTH_URL` and a real `BETTER_AUTH_SECRET` were intentionally not supplied to the validation build.
- `git diff --check`: PASS.

## Remaining security limitations and Polsia constraints

- The AI client still uses the Polsia AI proxy and Polsia credential, as explicitly required for this slice.
- The attachment upload route still uses the Polsia R2 upload proxy. Its returned URL is now sealed server-side and cannot be selected by the client, but a provider-neutral storage key/API is not available yet.
- The existing `Message.attachmentUrl` column stores the opaque token to avoid a Prisma schema change. A future storage-adapter migration should introduce an explicit storage-object identity and controlled legacy migration.
- Existing database rows containing pre-Phase-1A raw attachment URLs now fail closed and cannot be downloaded. Automatically fetching or converting those untrusted values would preserve the SSRF condition; a later migration can recover only URLs proven to belong to an approved storage namespace.
- Attachment tokens depend on `BETTER_AUTH_SECRET`; rotating that secret invalidates existing tokens unless a key-version/key-ring strategy is introduced.
- The AI limiter is process-local. Multiple application instances each enforce their own bucket, so a shared rate-limit store is recommended before higher-volume production use.
- These changes do not attempt the broader message, network, offer, RFQ, or provider redesigns reserved for later slices.

## Recommended next Phase 1 slice

Phase 1B should remain small and focus on authorization/IDOR coverage for existing message, offer, RFQ/response, transaction/deal-state, private-network, and document routes. Provider-neutral AI, email, and storage adapters should be handled as a separate subsequent slice so authorization review and infrastructure migration remain independently reviewable.
