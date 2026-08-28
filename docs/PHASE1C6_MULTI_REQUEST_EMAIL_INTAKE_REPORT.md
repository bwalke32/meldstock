# Meldstock Phase 1C.6 - Multi-Request and Email Intake

Date: 2026-08-27
Branch: `codex/phase1c6-multi-request-email-intake`

## 1. Reported failure and outcome

The Phase 1C.5 intake contract assumed one text submission contained one
material need. A real plastics request containing 5,000 lb of regrind ABS and a
separate 10,000-20,000 lb regrind PC need was therefore collapsed into one
draft.

Phase 1C.6 changes the protected intake boundary to return one to eight
independent, editable material drafts. Each draft has its own material,
condition, color, quantity, destination, questions, cautions, and explicit
`Send request privately` action. Sending one item cannot publish another item.

No database model or migration changed. No production data, deployment, mailbox,
or live AI provider was accessed.

## 2. Exact regression coverage

The reported request is now a permanent test case:

> Need 5,000/lbs. of Regrind ABS Injection-Grade Natural ASAP, FOB point is
> Romeoville, IL. Also looking for ~10-20k/lbs. of Regrind, PC Injection Grade
> 112 Blue-Tint Clear delivered to Romeoville, Illinois.

Expected behavior:

1. Create an editable ABS request for 5,000 lb, regrind, natural, Romeoville,
   Illinois, with ASAP shown as timing that needs a calendar date.
2. Create a separate editable PC request for a 10,000-20,000 lb range, regrind,
   blue-tint clear, Romeoville, Illinois.
3. Use the 10,000 lb minimum for the current numeric matching field while
   preserving the entire 10,000-20,000 lb range in the request details.
4. Warn the user to confirm whether `FOB point` means the delivery destination
   or only the freight-pricing point.
5. Require a separate send action for each request.

The local fallback recognizes slash-formatted pounds, abbreviated thousands,
quantity ranges, ASAP, full U.S. state names, FOB-point wording, and tinted-clear
colors. The AI schema independently requires an array of request items and tells
the model never to combine different polymers, grades, colors, conditions, or
quantities.

Raw pasted email text remains analysis input and a local browser draft. It is
not copied into the listing details. Common signature and quoted-reply tails are
removed, and contact-shaped data is redacted from generated detail lines.

## 3. Email ingestion decision

Meldstock should meet plastics professionals inside email, but it should not ask
for unrestricted access to every message in a mailbox.

The recommended order is:

### Phase A - Private forwarding address

- Give each verified user a revocable address such as
  `requests+<opaque-token>@inbound.meldstock.com`.
- The user manually forwards a customer request or creates a narrow mail rule.
- A signed inbound-mail webhook validates the recipient token and provider
  signature, deduplicates the RFC Message-ID, removes quoted history and common
  signatures, and sends only the selected content through multi-request intake.
- The result is an inbox of private drafts. Nothing is listed automatically.

This works with Google Workspace, Microsoft 365, and ordinary mail systems
without storing a user's mailbox OAuth token.

### Phase B - Gmail and Outlook action

- Add a `Send to Meldstock` action that runs only while the user is viewing a
  selected message.
- Google exposes a current-message read-only scope for Gmail add-ons:
  <https://developers.google.com/identity/protocols/oauth2/scopes>.
- The action sends the selected subject, clean body, and user-approved
  attachments to the same draft pipeline.

This is the cleanest connected-mail experience because consent occurs on each
message rather than for the entire inbox.

### Phase C - Optional label/folder sync

- Only if customers demand automation, allow an explicit `Meldstock Requests`
  label or folder to be synchronized.
- Gmail's API can list messages filtered by label, but the `gmail.readonly`
  authorization scope can view mailbox messages and settings:
  <https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list>.
- Microsoft Graph delegated `Mail.Read` permits reading the signed-in user's
  mailbox:
  <https://learn.microsoft.com/en-us/graph/permissions-reference#mailread>.
- Application code must therefore enforce the selected label/folder boundary;
  the OAuth grant itself is broader. This phase needs formal privacy review,
  encrypted token storage, revocation, retention controls, audit logs, and
  provider-approval work.

## 4. Required email safety controls

- Never publish an email-derived request automatically.
- Never contact the email sender automatically.
- Do not use mailbox content to train a shared model or enrich another company.
- Store provider tokens encrypted with a separately managed key and support
  immediate disconnect/revocation.
- Default to deleting raw email bodies after the user approves or rejects the
  drafts; retain only the sourcing fields and an auditable source reference.
- Block external image fetching and arbitrary remote attachment URLs.
- Scan attachments, enforce size/type limits, and reuse authenticated listing
  document controls.
- Deduplicate by mailbox/provider ID and RFC Message-ID.
- Preserve anonymous listing identity and listing-scoped private messaging.

## 5. Implementation boundary

This phase implements multi-material parsing and browser draft review. It does
not activate inbound SMTP, choose a permanent email vendor, create DNS records,
store mailbox credentials, or add a production webhook. Private forwarding is
the recommended next implementation because it delivers the email workflow with
the smallest permission and compliance footprint.

## 6. Verification

- Focused multi-request and API-boundary tests: 12 passed.
- Full Vitest suite: 209 passed; 1 intentionally gated database smoke test
  skipped.
- Production build: passed; `/api/ai/material-intake` remains in the route
  manifest.
- Prisma 6.19.3 schema validation: passed using a non-connecting local URL.
- Biome: no new findings; the same five accepted warnings remain in
  `jobs/stale-nudge.js`.
- TypeScript: no new findings; the same 16 accepted test-only diagnostics
  remain.
- `git diff --check`: passed.
