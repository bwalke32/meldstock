import 'server-only';
import { prisma } from '@/lib/db';
import type { SessionUser } from '@/lib/require-auth';

export type TrustedPostingProfile = {
  userId: string;
  displayName: string;
  companyName: string | null;
  handle: string;
  verificationStatus: 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'REJECTED';
  role: string;
};

export type TrustedPostingIdentity = {
  userId: string;
  displayName: string;
  profile: TrustedPostingProfile | null;
};

/** Resolve the persisted listing identity entirely from authenticated data. */
export async function getTrustedPostingIdentity(
  user: Pick<SessionUser, 'id' | 'name'>,
): Promise<TrustedPostingIdentity> {
  const profile = await prisma.profile.findUnique({
    where: { userId: user.id },
    select: {
      userId: true,
      displayName: true,
      companyName: true,
      handle: true,
      verificationStatus: true,
      role: true,
    },
  });
  const displayName =
    profile?.companyName?.trim() ||
    profile?.displayName?.trim() ||
    user.name?.trim() ||
    'Meldstock member';
  return { userId: user.id, displayName, profile };
}
