// @polsia:user-owned — your email templates. Edit, add, or delete freely.
// Each template returns { subject, html, text }; send it via the framework transport:
//   import { sendEmail } from '@/lib/email/send';
//   import { welcomeEmail } from '@/lib/email/templates';
//   await sendEmail({ to: user.email, ...welcomeEmail({ name: user.name }) });
// renderEmail() is a plain inline-styled shell — email clients drop <style>/<link>, so style inline.
// renderEmail() auto-escapes its heading/body/cta/footer, so pass RAW values (don't escapeHtml() them
// first — that double-escapes). escapeHtml() is only for when you hand-build an html string yourself.

/** Subject + rendered bodies — spread into sendEmail({ to, ... }). */
export interface EmailContent {
  subject: string;
  html: string;
  text?: string;
}

export interface RenderEmailOptions {
  heading: string;
  /** Body paragraphs (plain text; escaped for you). */
  body: string[];
  /** Optional call-to-action button. */
  cta?: { label: string; url: string };
  /** Optional footer line under the divider. */
  footer?: string;
}

/** Escape a value for safe interpolation into an HTML attribute or text node. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Wrap content in a minimal, inline-styled email shell. Restyle to match the brand. */
export function renderEmail(options: RenderEmailOptions): { html: string; text: string } {
  const paragraphs = options.body
    .map(
      (line) =>
        `<p style="margin:0 0 16px;color:#333333;font-size:15px;line-height:1.6;">${escapeHtml(line)}</p>`,
    )
    .join('');
  const button = options.cta
    ? `<p style="margin:24px 0 0;"><a href="${escapeHtml(options.cta.url)}" style="display:inline-block;padding:10px 20px;background:#111111;color:#ffffff;text-decoration:none;font-size:15px;">${escapeHtml(options.cta.label)}</a></p>`
    : '';
  const footer = options.footer
    ? `<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e5e5;color:#999999;font-size:12px;">${escapeHtml(options.footer)}</div>`
    : '';
  const html = [
    '<div style="max-width:560px;margin:0 auto;padding:24px;font-family:Arial,Helvetica,sans-serif;">',
    `<h1 style="margin:0 0 16px;color:#111111;font-size:22px;">${escapeHtml(options.heading)}</h1>`,
    paragraphs,
    button,
    footer,
    '</div>',
  ].join('');
  const text = [
    options.heading,
    '',
    ...options.body,
    ...(options.cta ? ['', `${options.cta.label}: ${options.cta.url}`] : []),
    ...(options.footer ? ['', options.footer] : []),
  ].join('\n');
  return { html, text };
}

// ─── Example templates — edit / add / remove to fit the app ───

/** Welcome email for a new signup. */
export function welcomeEmail(input: { name: string; ctaUrl?: string }): EmailContent {
  const { html, text } = renderEmail({
    heading: `Welcome, ${input.name}!`,
    body: ["Thanks for signing up — we're glad you're here."],
    cta: input.ctaUrl ? { label: 'Get started', url: input.ctaUrl } : undefined,
    footer: 'You received this because you created an account.',
  });
  return { subject: 'Welcome aboard', html, text };
}

/** Generic notification email. */
export function notificationEmail(input: {
  subject: string;
  title: string;
  lines: string[];
  cta?: { label: string; url: string };
}): EmailContent {
  const { html, text } = renderEmail({ heading: input.title, body: input.lines, cta: input.cta });
  return { subject: input.subject, html, text };
}

/** RFQ reply — sent to the **owner** of a WANTED lot when a buyer posts
 *  a message on the RFQ-scoped thread bound to that lot. Distinctive
 *  subject line so the owner can spot it in their inbox next to the
 *  generic thread-message alerts they may also receive (the bulk
 *  fan-out still fires for every thread participant including the
 *  owner when they're a participant). `listingTitle` is the human
 *  label a buyer sees on the listing card; `preview` is the truncated
 *  message body (≤120 chars). The CTA deep-links the owner straight
 *  into /messages/[threadId]. */
export function rfqReplyEmail(input: {
  listingTitle: string;
  preview: string;
  conversationUrl: string;
}): EmailContent {
  const lines = [`Listing: ${input.listingTitle}`, '', input.preview];
  const { html, text } = renderEmail({
    heading: 'New reply on your WANTED listing',
    body: lines,
    cta: { label: 'Open conversation →', url: input.conversationUrl },
    footer: 'You received this because a buyer replied to your WANTED listing on Meldstock.',
  });
  return { subject: '[Meldstock] New reply on your WANTED listing', html, text };
}

/** New message in a thread the recipient participates in. Subject + body
 *  carry the sender name; lot title is the live `${polymerLabel} · ${conditionLabel}`
 *  line (falls back to the thread's stored subject when the lot has been
 *  deleted). `preview` is the truncated — ≤120 chars — message body. The CTA
 *  links to /messages/[threadId] so a deep link from a notification lands on
 *  the exact conversation (the page redirects to the dashboard pane).
 *
 *  Subject is the brief-mandated "New message in your thread"; sender
 *  name is intentionally not in the subject so a quiet thread on a
 *  lot doesn't reveal who else is in the room when the recipient just
 *  glances at their inbox. The body still carries the sender name +
 *  lot title. */
export function threadMessageEmail(input: {
  recipientName: string;
  senderName: string;
  lotTitle: string;
  preview: string;
  conversationUrl: string;
}): EmailContent {
  const lines = [
    `Hi ${input.recipientName},`,
    `${input.senderName} just sent you a message about ${input.lotTitle}.`,
    input.preview,
  ];
  const { html, text } = renderEmail({
    heading: `${input.senderName} sent you a message on ${input.lotTitle}`,
    body: lines,
    cta: { label: 'Open conversation →', url: input.conversationUrl },
    footer: 'You received this because you participate in a conversation on Meldstock.',
  });
  return { subject: 'New message in your thread', html, text };
}

/** Digest variant — emitted when several messages land in the same
 *  thread for the same recipient within a 5-minute window. Capped at
 *  the most recent DIGEST_PREVIEW_LIMIT previews inline; any earlier
 *  ones are summarised by a single "...and N earlier messages" line so
 *  the email stays scannable and never overflows a phone screen.
 *  Subject + heading are plural to match the bulk nature of this alert. */
const DIGEST_PREVIEW_LIMIT = 5;

export function threadMessageDigestEmail(input: {
  recipientName: string;
  threadSubject: string;
  conversationUrl: string;
  items: Array<{ senderName: string; preview: string; sentAt: Date }>;
}): EmailContent {
  const total = input.items.length;
  const visible = input.items.slice(-DIGEST_PREVIEW_LIMIT);
  const earlierCount = Math.max(0, total - visible.length);
  const lines: string[] = [
    `Hi ${input.recipientName},`,
    `${total} new message${total === 1 ? '' : 's'} in ${input.threadSubject}:`,
    '',
    ...visible.flatMap((item) => [`• ${item.senderName}: ${item.preview}`, '']),
    ...(earlierCount > 0
      ? [`…and ${earlierCount} earlier message${earlierCount === 1 ? '' : 's'}.`, '']
      : []),
  ];
  const { html, text } = renderEmail({
    heading: `${total} new message${total === 1 ? '' : 's'} in ${input.threadSubject}`,
    body: lines,
    cta: { label: 'Open conversation →', url: input.conversationUrl },
    footer: 'You received this because you participate in a conversation on Meldstock.',
  });
  return {
    subject: `${total} new message${total === 1 ? '' : 's'} in your thread`,
    html,
    text,
  };
}

/** Saved-search match — a freshly-posted lot matches one of the user's
 *  saved browse searches. The dashboard cell carries the same `matchCount`
 *  so the email and the dashboard stay consistent. `matchesUrl` is the
 *  /lots URL with the saved filter pre-applied (one-click jump back to
 *  the floor). */
export function savedSearchMatchEmail(input: {
  user: { name: string };
  savedSearchName: string;
  lotSummary: string;
  matchesUrl: string;
  matchedFiltersCount: number;
}): EmailContent {
  const lines = [
    `Hi ${input.user.name},`,
    `A new lot just landed on the floor that matches your saved search "${input.savedSearchName}".`,
    '',
    input.lotSummary,
    '',
    `At least ${input.matchedFiltersCount} filter${input.matchedFiltersCount === 1 ? '' : 's'} of your saved search matched.`,
    'Manage saved searches from your dashboard.',
  ];
  const { html, text } = renderEmail({
    heading: 'A new lot matched your saved search',
    body: lines,
    cta: { label: 'Open the matches →', url: input.matchesUrl },
    footer: 'You received this because you saved a search on Meldstock.',
  });
  return {
    subject: 'A new lot matched your saved search',
    html,
    text,
  };
}

/** WANTED-specific saved-search match — sent when a freshly-posted WANTED
 *  lot matches a user's saved browse search. Sits next to the generic
 *  `savedSearchMatchEmail` so the /api/lots fan-out can pick the right
 *  wording for the post type. Input shape mirrors `savedSearchMatchEmail`
 *  so the call site stays symmetric. */
export function wantedSavedSearchMatchEmail(input: {
  user: { name: string };
  savedSearchName: string;
  lotSummary: string;
  matchesUrl: string;
  matchedFiltersCount: number;
}): EmailContent {
  const lines = [
    `Hi ${input.user.name},`,
    `A new WANTED lot just landed on the floor that matches your saved search "${input.savedSearchName}".`,
    '',
    input.lotSummary,
    '',
    `At least ${input.matchedFiltersCount} filter${input.matchedFiltersCount === 1 ? '' : 's'} of your saved search matched.`,
    'Manage saved searches from your dashboard.',
  ];
  const { html, text } = renderEmail({
    heading: 'New WANTED matches your saved search',
    body: lines,
    cta: { label: 'Open the matches →', url: input.matchesUrl },
    footer:
      'You received this because you saved a search on Meldstock and a new WANTED matched it.',
  });
  return {
    subject: 'New WANTED matches your saved search',
    html,
    text,
  };
}

/** Inventory stale-nudge — sent once per day per owner when at least one
 *  of their ACTIVE listings crossed the 30-day staleness window without a
 *  confirmation. `items` lists the stale lots with their last-update
 *  timestamps so the recipient can scan-fast which listings are old. The
 *  CTA points at `/dashboard/inventory` (with a `?focus` anchor the
 *  island can use to highlight one specific lot — the cron passes the
 *  first stale id so the recipient lands on something actionable even
 *  if their inbox is full). */
export function staleNudgeEmail(input: {
  recipientName: string;
  items: Array<{ id: string; title: string; lastUpdatedAt: string }>;
  confirmUrlBase: string;
}): EmailContent {
  const itemLines = input.items.flatMap((item) => {
    const date = new Date(item.lastUpdatedAt);
    const stamp = Number.isNaN(date.getTime())
      ? item.lastUpdatedAt
      : date.toISOString().slice(0, 10);
    return [`• ${item.title}  —  last touched ${stamp}`, ''];
  });
  const firstId = input.items[0]?.id;
  const focusSuffix = firstId ? `?focus=${encodeURIComponent(firstId)}` : '';
  const ctaUrl = `${input.confirmUrlBase.replace(/\/+$/, '')}${focusSuffix}`;
  const subject = `${input.items.length} listing${input.items.length === 1 ? '' : 's'} need a check-in`;
  const lines = [
    `Hi ${input.recipientName},`,
    input.items.length === 1
      ? 'One of your listings has been sitting idle for over a month on the floor:'
      : `${input.items.length} of your listings have sat idle for over a month on the floor:`,
    '',
    ...itemLines,
    'Tap through to confirm you still have each one, edit the remaining quantity, or deactivate it. Listings left untouched may be auto-expired by the daily nudge job.',
  ];
  const { html, text } = renderEmail({
    heading: 'Still have these listings?',
    body: lines,
    cta: { label: 'Open your inventory →', url: ctaUrl },
    footer: 'You received this because these listings crossed the 30-day idle threshold.',
  });
  return { subject, html, text };
}

// --- Structured offer / counter-offer emails -------------------------------
//
// These ride the same inline-styled `renderEmail()` shell as every other
// user-facing email on the platform. All subjects carry the `[Meldstock]`
// prefix the existing `rfqReplyEmail` uses so the seller / buyer can spot
// them in a mixed inbox. Pricing strings (`priceLabel`) are pre-formatted
// by the routes (currency / unit included) so the renderEmail body stays a
// straight string interpolation — never embed raw Decimal values here.

/** Buyer-initiated offer. Sent to the seller. The CTA deep-links to the
 *  /lots/[id] page where the offer appears in the negotiation timeline. */
export function offerReceivedEmail(input: {
  recipientName: string;
  lotTitle: string;
  buyerDisplayName: string;
  priceLabel: string;
  quantityLabel: string;
  expiresAt: string;
  lotUrl: string;
}): EmailContent {
  const expires = formatShortDate(input.expiresAt);
  const lines = [
    `Hi ${input.recipientName},`,
    `${input.buyerDisplayName} made an offer on your listing: ${input.lotTitle}.`,
    '',
    `Quantity requested: ${input.quantityLabel}`,
    `Price: ${input.priceLabel}`,
    `Offer expires on ${expires}.`,
    'Open the lot to ACCEPT, COUNTER with your own terms, or DECLINE.',
  ];
  const { html, text } = renderEmail({
    heading: 'New offer on your listing',
    body: lines,
    cta: { label: 'Review offer →', url: input.lotUrl },
    footer: 'You received this because a buyer made a structured offer on one of your listings.',
  });
  return { subject: '[Meldstock] New offer on your listing', html, text };
}

/** Counter sent on either side. Sent to BOTH parties so each side can see
 *  the live terms without opening the lot page. `byDisplayName` is the
 *  party who JUST countered (seller or buyer). */
export function offerCounteredEmail(input: {
  recipientName: string;
  lotTitle: string;
  byDisplayName: string;
  priceLabel: string;
  quantityLabel: string;
  expiresAt: string;
  lotUrl: string;
}): EmailContent {
  const expires = formatShortDate(input.expiresAt);
  const lines = [
    `Hi ${input.recipientName},`,
    `${input.byDisplayName} countered the offer on ${input.lotTitle}.`,
    '',
    `Quantity: ${input.quantityLabel}`,
    `Price: ${input.priceLabel}`,
    expires ? `New expiry: ${expires}.` : '',
  ].filter(Boolean) as string[];
  const { html, text } = renderEmail({
    heading: 'Offer countered',
    body: lines,
    cta: { label: 'Open negotiation →', url: input.lotUrl },
    footer:
      'You received this because you are a party to a structured offer on a Meldstock listing.',
  });
  return { subject: '[Meldstock] Offer countered', html, text };
}

/** Accepted. Sent to both sides. After this email the deal moves into the
 *  existing PO → pickup → transit → delivered → completed stepper. */
export function offerAcceptedEmail(input: {
  recipientName: string;
  lotTitle: string;
  acceptedByDisplayName: string;
  finalPriceLabel: string;
  quantityLabel: string;
  threadUrl: string;
}): EmailContent {
  const lines = [
    `Hi ${input.recipientName},`,
    `${input.acceptedByDisplayName} accepted the offer on ${input.lotTitle}.`,
    '',
    `Quantity: ${input.quantityLabel}`,
    `Final price: ${input.finalPriceLabel}`,
    'The deal moves into the operational stepper — issue PO, schedule pickup, track transit, close out. Open the thread to advance through each stage.',
  ];
  const { html, text } = renderEmail({
    heading: 'Offer accepted',
    body: lines,
    cta: { label: 'Open the deal →', url: input.threadUrl },
    footer: 'You received this because you are a party to the accepted offer.',
  });
  return { subject: '[Meldstock] Offer accepted', html, text };
}

/** Declined. Sent to the OFFERING party (the one whose offer was declined)
 *  so they can decide whether to re-offer / walk away. */
export function offerDeclinedEmail(input: {
  recipientName: string;
  lotTitle: string;
  byDisplayName: string;
  lotUrl: string;
}): EmailContent {
  const lines = [
    `Hi ${input.recipientName},`,
    `${input.byDisplayName} declined the offer on ${input.lotTitle}.`,
    '',
    'Open the listing to submit a revised offer, or reach out via the thread to clarify terms.',
  ];
  const { html, text } = renderEmail({
    heading: 'Offer declined',
    body: lines,
    cta: { label: 'Open listing →', url: input.lotUrl },
    footer: 'You received this because you made a structured offer that was declined.',
  });
  return { subject: '[Meldstock] Offer declined', html, text };
}

/** Withdrawn. Sent to the COUNTERPART so they know the negotiation is no
 *  longer live on this row. */
export function offerWithdrawnEmail(input: {
  recipientName: string;
  lotTitle: string;
  byDisplayName: string;
  lotUrl: string;
}): EmailContent {
  const lines = [
    `Hi ${input.recipientName},`,
    `${input.byDisplayName} withdrew their offer on ${input.lotTitle}.`,
    '',
    'If you still want this material, open the listing and submit a fresh offer.',
  ];
  const { html, text } = renderEmail({
    heading: 'Offer withdrawn',
    body: lines,
    cta: { label: 'Open listing →', url: input.lotUrl },
    footer: 'You received this because a structured offer on this listing was withdrawn.',
  });
  return { subject: '[Meldstock] Offer withdrawn', html, text };
}

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}

// --- Structured WANTED-seller-response emails -----------------------------
//
// Mirrors the HAVE-side `offerReceivedEmail` family but flipped for the
// WANTED/RFQ side: the lot poster is the "buyer", the responding
// seller is the "seller". All subjects carry the `[Meldstock]` prefix
// so the recipient can spot them in a mixed inbox next to
// `rfqReplyEmail` alerts (the structured-response POST fires
// `rfqReplyEmail` AND `wantedResponseReceivedEmail` in parallel so the
// two alerts land together; the distinct subject lets the recipient
// segment them).
//
// Pricing strings (`priceLabel` / `quantityLabel`) are pre-formatted by
// the routes (currency / unit included) so the renderEmail body stays
// a straight string interpolation — never embed raw Decimal values
// here.

/** New structured seller response on a WANTED listing. Sent to the lot
 *  poster. Pairs with the existing `rfqReplyEmail` which also fires
 *  from the same POST so the lot poster gets BOTH alerts (distinct
 *  subjects). The CTA deep-links to the lot detail page where the
 *  response chain surfaces. */
export function wantedResponseReceivedEmail(input: {
  recipientName: string;
  lotTitle: string;
  sellerDisplayName: string;
  priceLabel: string;
  quantityLabel: string;
  expiresAt: string;
  lotUrl: string;
}): EmailContent {
  const expires = formatShortDate(input.expiresAt);
  const lines = [
    `Hi ${input.recipientName},`,
    `${input.sellerDisplayName} sent a structured response on your WANTED listing: ${input.lotTitle}.`,
    '',
    `Available quantity: ${input.quantityLabel}`,
    `Price: ${input.priceLabel}`,
    `Offer expires on ${expires}.`,
    'Open the listing to ACCEPT, COUNTER with your own terms, or DECLINE. The full negotiation history stays preserved.',
  ];
  const { html, text } = renderEmail({
    heading: 'New structured response on your WANTED listing',
    body: lines,
    cta: { label: 'Review response →', url: input.lotUrl },
    footer:
      'You received this because a seller submitted a structured response on your Meldstock WANTED listing.',
  });
  return { subject: '[Meldstock] New structured response on your WANTED listing', html, text };
}

/** Counter sent on either side. Sent to BOTH parties so each side can
 *  see the live terms without opening the lot page. `byDisplayName` is
 *  the party who JUST countered: usually the RFQ poster on the wanted
 *  side (counter is buyer-only there). */
export function wantedResponseCounteredEmail(input: {
  recipientName: string;
  lotTitle: string;
  byDisplayName: string;
  priceLabel: string;
  quantityLabel: string;
  expiresAt: string;
  lotUrl: string;
}): EmailContent {
  const expires = formatShortDate(input.expiresAt);
  const lines = [
    `Hi ${input.recipientName},`,
    `${input.byDisplayName} countered the response on ${input.lotTitle}.`,
    '',
    `Quantity: ${input.quantityLabel}`,
    `Price: ${input.priceLabel}`,
    expires ? `New expiry: ${expires}.` : '',
  ].filter(Boolean) as string[];
  const { html, text } = renderEmail({
    heading: 'Response countered',
    body: lines,
    cta: { label: 'Open negotiation →', url: input.lotUrl },
    footer:
      'You received this because you are a party to a structured seller response on a Meldstock WANTED listing.',
  });
  return { subject: '[Meldstock] Response countered', html, text };
}

/** Accepted on the WANTED side. Sent to BOTH parties. After this email
 *  the deal moves into the existing PO → pickup → transit → delivered
 *  → completed stepper on the thread — same pipeline as a
 *  HAVE-listing Offer accept. */
export function wantedResponseAcceptedEmail(input: {
  recipientName: string;
  lotTitle: string;
  acceptedByDisplayName: string;
  finalPriceLabel: string;
  quantityLabel: string;
  threadUrl: string;
}): EmailContent {
  const lines = [
    `Hi ${input.recipientName},`,
    `${input.acceptedByDisplayName} accepted the response on ${input.lotTitle}.`,
    '',
    `Quantity: ${input.quantityLabel}`,
    `Final price: ${input.finalPriceLabel}`,
    'The deal moves into the operational stepper — issue PO, schedule pickup, track transit, close out. Open the thread to advance through each stage.',
  ];
  const { html, text } = renderEmail({
    heading: 'Response accepted',
    body: lines,
    cta: { label: 'Open the deal →', url: input.threadUrl },
    footer: 'You received this because you are a party to the accepted response.',
  });
  return { subject: '[Meldstock] Response accepted', html, text };
}

/** Declined. Sent to the AUTHOR (the respondent for a root row, or
 *  the buyer for a counter row) so they can decide whether to
 *  re-respond / walk away. */
export function wantedResponseDeclinedEmail(input: {
  recipientName: string;
  lotTitle: string;
  byDisplayName: string;
  lotUrl: string;
}): EmailContent {
  const lines = [
    `Hi ${input.recipientName},`,
    `${input.byDisplayName} declined the response on ${input.lotTitle}.`,
    '',
    'Open the listing to submit a revised response, or reach out via the thread to clarify terms.',
  ];
  const { html, text } = renderEmail({
    heading: 'Response declined',
    body: lines,
    cta: { label: 'Open listing →', url: input.lotUrl },
    footer: 'You received this because a structured response on your WANTED listing was declined.',
  });
  return { subject: '[Meldstock] Response declined', html, text };
}

/** Withdrawn. Sent to the COUNTERPART so they know the negotiation is
 *  no longer live on this row. */
export function wantedResponseWithdrawnEmail(input: {
  recipientName: string;
  lotTitle: string;
  byDisplayName: string;
  lotUrl: string;
}): EmailContent {
  const lines = [
    `Hi ${input.recipientName},`,
    `${input.byDisplayName} withdrew their response on ${input.lotTitle}.`,
    '',
    'If you still want this material, leave the listing open — other sellers can respond as well.',
  ];
  const { html, text } = renderEmail({
    heading: 'Response withdrawn',
    body: lines,
    cta: { label: 'Open listing →', url: input.lotUrl },
    footer: 'You received this because a structured response on this WANTED listing was withdrawn.',
  });
  return { subject: '[Meldstock] Response withdrawn', html, text };
}
