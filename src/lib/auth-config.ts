// @polsia:user-owned — configure better-auth here (spread into betterAuth() by @/lib/auth).
// Add emailAndPassword options, plugins, session, socialProviders, databaseHooks, etc.
// Framework owns db/secret/baseURL/admin() + the owner-admin grant (no-op if set here).
//
// Welcome email / signup side-effect (runs alongside the owner-admin grant — install `email`):
//   import { sendEmail } from '@/lib/email/send';
//   databaseHooks: { user: { create: { after: async (user) => {
//     await sendEmail({ to: user.email, subject: 'Welcome', html: '<p>Welcome!</p>' }).catch(() => {});
//   } } } },
// Add a plugin: `plugins: [organization()]` (admin() is added for you).
//
// Per-user fields (a `username`, profile, prefs): don't add a column to `User` (auth.prisma
// is locked) or use `user.additionalFields` (needs that locked column). Make a user-owned
// `prisma/schema/profile.prisma` (model UserProfile { userId String @unique /* fields */ },
// scalar userId) and create the row at signup:
//   import { prisma } from '@/lib/db';
//   databaseHooks: { user: { create: { after: async (user) => {
//     await prisma.userProfile.create({ data: { userId: user.id } }).catch(() => {});
//   } } } },

import 'server-only';
import type { BetterAuthOptions } from 'better-auth';
import { prisma } from '@/lib/db';

// Per-user fields (a `username`, profile, prefs): don't add a column to `User`
// (auth.prisma is locked) or use `user.additionalFields` (needs that locked
// column). Make a user-owned `prisma/schema/profile.prisma` (model Profile
// { userId String @unique /* fields */ }, scalar userId) and create the row
// at signup so every UI surface (thread header, lot poster handle, dashboard
// greeting) has a displayName to read instead of falling back to "User".
//
// Hook runs on better-auth's `databaseHooks.user.create.after` — at this
// point the auth-flow row is committed and the id is stable. Slugifies
// displayName into a unique `@handle` and writes the row. The
// better-auth-side `Account` row links the user, no extra model needed.
// Failures are swallowed (the seed-style idempotency is acceptable: a
// transient hiccup at signup shouldn't brick sign-in).
async function ensureProfile(user: { id: string; name?: string | null; email?: string | null }) {
  try {
    const existing = await prisma.profile.findUnique({ where: { userId: user.id } });
    if (existing) return;
    const displayName = (
      user.name && user.name.trim().length >= 2
        ? user.name.trim()
        : (user.email?.split('@')[0] ?? 'Trader')
    ).slice(0, 120);
    // Slugify into a URL-safe handle — drop characters the route
    // contract enforces (lowercase + alnum + dash, max 40 chars),
    // dedupe in a 6-attempt loop, then fall back to a timestamped
    // suffix. Mirrors the generateHandle logic in /api/profile so the
    // auto-created row and the user-edited row stay on the same shape.
    const baseRaw =
      displayName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'user';
    let candidate = baseRaw;
    for (let i = 0; i < 6; i += 1) {
      const taken = await prisma.profile.findUnique({ where: { handle: candidate } });
      if (!taken) break;
      candidate = `${baseRaw}-${Math.random().toString(36).slice(2, 6)}`;
    }
    if (candidate.length > 40) candidate = candidate.slice(0, 40);
    await prisma.profile.create({
      data: {
        userId: user.id,
        // 'INDIVIDUAL' is the safe default at signup; the user
        // completes Step-2 in /signup or /profile/edit to mark
        // themselves a COMPANY.
        accountType: 'INDIVIDUAL',
        displayName,
        role: 'BROKER_TRADER',
        handle: candidate,
      },
    });
  } catch {
    // Swallow — sign-in still works even if profile creation hiccups.
  }
}

export const authConfig: BetterAuthOptions = {
  emailAndPassword: {
    enabled: true,
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          await ensureProfile({ id: user.id, name: user.name, email: user.email });
        },
      },
    },
  },
};
