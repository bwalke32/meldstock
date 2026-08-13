// @polsia:user-owned — anonymity classifier for messaging fan-out.
//
// `ANONYMOUS` listings hide the poster's identity on the wire (see
// @/lib/business/lot-visibility#ANONYMOUS_SCRUB) — the lot card lists
// "Meldstock-verified seller" for any profile lookup, and the message
// dialog never shows `postedByHandle`. The MESSAGE THREAD side of the
// same listing still needs the same protection: any fan-out that
// surfaces the poster's `displayName` would leak the broker's real
// identity to the buyer's inbox and email.
//
// This helper centralises the rule. Callers include /api/threads/
// [threadId]/messages POST (when fanning out to other participants)
// and the inbox-row recorder. Masking turns the displayed sender
// into "the seller" for inbox rows + email subject lines.
import 'server-only';

export type AnonymityMode = 'NONE' | 'ANONYMOUS_LOT_SIDE';

/**
 * Determines whether the SENDER of a thread message has their identity
 * hidden on outbound fan-out:
 *   - 'NONE': the listing is not ANONYMOUS, the sender is not the lot
 *     poster (a buyer side, an unlinked lot, anonymous-no-poster, or a
 *     non-ANON listing), or there's no concrete poster userId to mask
 *     against — the buyer's identity is intentional on WANTED replies.
 *   - 'ANONYMOUS_LOT_SIDE': the source lot is ANONYMOUS AND the sender
 *     IS the posting owner — the broker's displayName would otherwise
 *     leak through the inbox row + email fan-out.
 */
export function anonymityFor(
  lot: { visibility: string | null; postedByUserId: string | null } | null,
  senderId: string,
): AnonymityMode {
  if (!lot) return 'NONE';
  if (lot.visibility !== 'ANONYMOUS') return 'NONE';
  if (lot.postedByUserId === null) {
    // Anonymous-no-poster — the lot was posted under a stale legacy
    // free-text postedByName. There's no broker account to mask, so we
    // leave the wire alone; the buyer's reply carries the buyer's name.
    return 'NONE';
  }
  if (lot.postedByUserId !== senderId) return 'NONE';
  return 'ANONYMOUS_LOT_SIDE';
}

/**
 * Display stringified name of the sender on the wire when anonymity
 * applies. Short, deliberately distinguishable from the lot wire's
 * "Meldstock-verified seller" so an inbox row labels a different
 * surface ("the seller") without implying that a real profile is
 * sitting one click away.
 */
export const ANONYMOUS_THREAD_SENDER = 'the seller';

export function maskedSenderName(mode: AnonymityMode, realName: string | null | undefined): string {
  if (mode === 'ANONYMOUS_LOT_SIDE') return ANONYMOUS_THREAD_SENDER;
  return realName && realName.length > 0 ? realName : 'User';
}
