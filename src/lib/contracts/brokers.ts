// @polsia:user-owned — shared zod contract for the public broker-profile
// resource at /brokers/[id]. Imported by the /api/brokers/[id] route handler
// (server) AND the /brokers/[id]/page.tsx client island (client); keeps the
// route ↔ page shape in lockstep so a server-side contract change is a tsc
// error / runtime ZodError on the client, not silent drift.
//
// Only PUBLIC, MARKETING-safe fields live here — phone / publicEmail /
// private websiteUrl are deliberately NOT in this wire. /u/[handle] is the
// loading-dock for the full profile surface; /brokers/[id] is the broker
// marketing card and stays narrow.
import { z } from 'zod';
import { BusinessRoleEnum } from '@/lib/contracts/profiles';

export const BrokerProfileItem = z.object({
  id: z.string(),
  userId: z.string(),
  displayName: z.string(),
  // Handle slug — drives the secondary /u/<handle> cross-link. Nullable
  // because Profile.handle is a required column, but kept on the wire
  // anyway so the route can opt to scrub it server-side in the future.
  handle: z.string().nullable(),
  companyName: z.string().nullable(),
  // Profile.role — narrowed to BROKER_TRADER by /api/brokers/[id] server-
  // side, but kept as the wider enum so a non-broker role can still resolve
  // a 200 if the founder flips the routing rule later.
  role: BusinessRoleEnum,
  accountType: z.enum(['INDIVIDUAL', 'COMPANY']),
  // Mirror of Profile.verificationStatus, expressed at the UI-ready badge
  // enum so the client island doesn't have to map it.
  verifiedBadge: z.enum(['none', 'pending', 'verified', 'rejected']),
  // Convenience boolean for the "Verified company" stamp on the public
  // broker card — true iff the badge is currently VERIFIED.
  verifiedCompany: z.boolean(),
  // ISO timestamp — the broker's `Profile.createdAt`. Drives the "Member
  // since <Month YYYY>" line. Stored as a string (not Date) because the
  // wire is JSON and Date serialises inconsistently across runtimes.
  memberSince: z.string(),
  // Server-resolved count of `Lot` rows with `postedByUserId === id` AND
  // `status === 'ACTIVE'`. Drives the "Active listings: N" tile.
  activeListingsCount: z.number().int().nonnegative(),
  // Server-resolved count of `MessageThread` rows where the broker-attached
  // user is buyer OR seller AND `status === 'COMPLETED'`. "as intermediary"
  // per the brief resolves to "any thread the broker is a party on that's
  // reached the COMPLETED closeout state".
  closedDealsCount: z.number().int().nonnegative(),
});
export type BrokerProfileItem = z.infer<typeof BrokerProfileItem>;

export const BrokerProfileResponse = z.object({
  item: BrokerProfileItem,
});
export type BrokerProfileResponse = z.infer<typeof BrokerProfileResponse>;
