# Meldstock Phase 1C.5 - AI Material Request Copilot

Date: 2026-08-27
Branch: `codex/phase1c5-ai-material-request-copilot`

## 1. Scope and outcome

This phase adds an executable AI-assisted material-intake workflow in front of
the existing authenticated, anonymous WANTED-request path. A molder can paste a
plain-language requirement, receive an editable sourcing brief, review missing
facts and cautions, and then explicitly send the request through the existing
listing API.

No database model or migration changed. No production data, deployment, or
production provider was accessed.

## 2. User workflow

1. The homepage accepts an email, resin shorthand, or natural-language need in
   one text box.
2. A local deterministic parser immediately previews recognized resin facts.
3. The protected `/api/ai/material-intake` route requires authentication before
   a metered AI call.
4. Configured AI returns strict structured data; disabled or failed AI returns a
   deterministic draft.
5. The molder reviews and edits all normal material-request fields.
6. Only the separate `Send private request` action creates the anonymous WANTED
   listing.

## 3. AI and provider architecture

- `AI_PROVIDER=disabled` remains the safe default.
- `AI_PROVIDER=openai` selects an optional independent adapter using the OpenAI
  Responses API for non-streaming completions.
- The adapter uses the existing provider-neutral `AiService` contract.
- Structured output accepts a named JSON Schema in the provider-neutral request
  type.
- Responses requests set `store: false` and cap output tokens.
- The legacy Polsia compatibility adapter remains available and now understands
  the same structured-output contract.
- Existing streaming chat keeps its compatible event wire format.

## 4. Extraction and matching discipline

The model may extract stated facts, normalize units and dates, and identify
ambiguity. It may not declare a resin equivalent, approve suitability, infer an
unstated certification, or publish a request.

The shared deterministic resin normalizer remains authoritative for an
unambiguous polymer token. If its result conflicts with AI output, the shared
parser wins and the review screen receives a caution. This preserves the
repository rule that structured matching comes first and AI is secondary.

## 5. Security and privacy controls

- Auth is checked before parsing or provider use.
- Existing per-user AI rate limiting is applied before provider use.
- Request input is strict, limited to 4,000 characters, and cannot select a
  model or task.
- The server fixes `gpt-4o-mini`, the `material-intake` task, output schema, and
  token cap.
- Source text is treated as untrusted data in the server instruction.
- Provider failures return the local fallback without returning provider error
  details.
- The analysis endpoint performs no database write.
- The normal listing route still derives ownership from the authenticated
  server session and preserves anonymous buyer identity.
- API keys remain server-only and are not committed.

## 6. Files changed

- Intake UI: homepage sourcing console, request-material form, and page copy.
- Contracts and normalization: `src/lib/contracts/material-intake.ts` and
  `src/lib/business/material-intake.ts`.
- Protected API: `src/app/api/ai/material-intake/route.ts`.
- AI schema/prompt: `src/lib/ai/material-intake.ts`.
- Provider layer: AI client, types, adapters, registry, environment schema, and
  `.env.example`.
- Runtime documentation: `docs/INDEPENDENT_RUNTIME.md`.
- Regression tests: material intake, route security/fallback, provider request
  shape, and environment selection.

## 7. Verification

- Focused verification: 24 tests passed.
- Full Vitest suite: 206 passed, 1 intentionally gated database smoke test
  skipped.
- Production build: passed; `/api/ai/material-intake` is present in the route
  manifest.
- Prisma 6.19.3 schema validation: passed using a non-connecting placeholder
  PostgreSQL URL.
- Biome: no new findings; the same five accepted warnings remain in
  `jobs/stale-nudge.js`.
- TypeScript: no new findings; the same 16 accepted test-only diagnostics remain.
- `git diff --check`: passed.

## 8. Remaining limitations

- No live metered provider request was made because no API key was supplied.
- The deterministic fallback is intentionally conservative and asks the user to
  confirm missing facts.
- File/PDF extraction is not included in this slice.
- AI output is not a technical approval, compliance determination, or substitute
  for resin qualification.

## 9. Recommended next phase

Exercise the optional AI adapter in a disposable environment with a project key
and spending limit, add a curated resin-request evaluation set, and compare
field-level extraction accuracy against the deterministic fallback before any
production enablement.
