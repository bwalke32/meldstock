# Meldstock — Codex Repository Instructions

## Project status
Meldstock is a real B2B thermoplastics trading application originally generated and hosted by Polsia. This repository is now being transitioned to direct ownership and development outside Polsia.

The existing `.polsia/**` files, `@polsia:*` source banners, ownership maps, and restrictions in the original Polsia `AGENTS.md` are HISTORICAL REFERENCE ONLY. They do not prohibit Codex from editing files when required to make Meldstock portable, secure, and maintainable. Preserve the original Polsia instructions separately as `AGENTS.polsia.md` for reference.

## Primary objective
Take ownership of the EXISTING application. Do not rewrite Meldstock from scratch. Preserve working product functionality while removing Polsia-specific infrastructure dependencies, fixing critical security issues, and creating a stable locally runnable/deployable codebase.

## Product identity
Meldstock is the professional trading network for thermoplastic resin. The product centers on:
- HAVE / WANTED live trading
- plastics-specific search and normalization
- inventory upload and management
- private broker networks
- RFQs
- messaging and documents
- offer/counteroffer negotiation
- broker confidentiality
- matching between supply and demand

Do not turn it into generic e-commerce or a recycled-plastics-only marketplace.

## Non-negotiable engineering rules
1. Never expose or commit secrets, tokens, credentials, or production database contents.
2. Do not delete working features merely to simplify migration.
3. Prefer small, reviewable changes over broad rewrites.
4. Run typecheck/tests/build after meaningful changes when the environment permits.
5. Use version-controlled Prisma migrations for durable schema changes. Do not use `prisma db push --accept-data-loss` for production.
6. Commercial mutations must derive ownership from the authenticated server session. Never trust a client-supplied user/company id as proof of ownership.
7. Privacy and listing-visibility rules must be enforced server-side, not only hidden in UI.
8. Private documents and messages must require authorization on every read/download route.
9. Do not invent market activity, transaction counts, price indexes, or production data. Demo data must be explicitly labeled DEMO/SAMPLE.
10. Do not claim a feature is complete because a page exists. Complete means the full persisted workflow works with correct permissions.

## Migration priorities
### P0 — Preserve and establish baseline
- Initialize/verify Git history and clean working tree.
- Inventory app routes, APIs, Prisma models, tests, env vars, and Polsia dependencies.
- Get a clean local baseline or precisely document what blocks it.
- Do not add product features during P0.

### P1 — Remove Polsia lock-in
Create replaceable service adapters for:
- AI/LLM calls
- transactional email
- object/document storage
- analytics
- scheduled stale-inventory notifications
- deployment/database configuration

Prefer provider-neutral interfaces. Local development must not require Polsia credentials.

### P1 — Critical security
- Require authentication for creating commercial listings and other protected mutations.
- Always set listing owner from the authenticated session.
- Protect AI endpoints from anonymous/metered abuse.
- Audit all message, offer, RFQ, file, listing, and private-network routes for authorization and IDOR risks.
- Validate uploads and private download access.

### P2 — Production database discipline
- Replace production `db push --accept-data-loss` behavior with Prisma migrations.
- Produce a reproducible local/dev database setup.
- Keep seed/demo data opt-in and clearly labeled.

### P2 — Plastics data model
Before real beta data accumulates, evaluate structured support for important material fields and families, including PC/ABS, PC/PBT, PPO/PPE, PEI, reinforcement %, MFR/MFI, MVR, flame rating, UV, impact modification, recycled content, FDA/food-contact, UL status, packaging, lot/batch data, and units.
Do not make a large schema migration without first documenting the proposed migration and compatibility impact.

### P3 — Product improvements
Only after portability/security/baseline are stable: refine matching, company/multi-user architecture, UX, beta administration, and additional product features.

## Matching philosophy
Use deterministic structured matching first. Use AI secondarily for normalization, equivalency inference, ambiguous descriptions, and explanations. Do not spend an LLM call on facts that structured fields can resolve reliably.

## Company architecture
The current app largely stores company information on individual profiles. Before broad beta adoption, evaluate whether a first-class Company / CompanyMember model is needed for multi-user company accounts, company inventory, verification, permissions, and roles. Do not implement this casually; propose the migration first.

## Testing expectation
Maintain or add tests for security-sensitive changes. Important end-to-end scenario:
Seller posts 10,000 lb SABIC CYCOLOY C6600 Black Prime Virgin in Chicago -> buyer posts WANTED C6600 Black 5,000 lb -> match -> message -> document -> offer -> counter -> accept -> transaction stages -> delivered/completed -> ratings.

## Working style
Before a large change:
1. State what you found.
2. State the smallest safe change.
3. Make the change.
4. Run relevant checks.
5. Summarize files changed and remaining risks.

If requirements conflict, prioritize data safety, authentication/authorization, broker confidentiality, and preserving existing working behavior.
