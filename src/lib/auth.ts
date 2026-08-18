// @polsia:framework-owned - DO NOT EDIT. Code installed by polsia/modules/better-auth@0.8.0. Drift = commit rejected.
// Protected core (db/secret/baseURL, admin plugin, multi-host trustedOrigins) + owner-admin grant,
// composed with the app's own databaseHooks. Configure auth in @/lib/auth-config (user-owned).

import 'server-only';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { admin } from 'better-auth/plugins';
import { authConfig } from '@/lib/auth-config';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';

// Compose the owner-admin grant with the app's hooks — don't overwrite them.
const appHooks = authConfig.databaseHooks;

// Every additional host must be explicitly configured to pass Better Auth's
// Origin/CSRF check. baseURL's own origin is trusted implicitly.
export const trustedOrigins = [
  ...(env.BETTER_AUTH_TRUSTED_ORIGINS?.split(',')
    .map((o) => o.trim())
    .filter(Boolean) ?? []),
];

export const auth = betterAuth({
  ...authConfig,
  database: prismaAdapter(prisma, {
    provider: 'postgresql',
  }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  trustedOrigins,
  databaseHooks: {
    ...appHooks,
    user: {
      ...appHooks?.user,
      create: {
        ...appHooks?.user?.create,
        before: async (user, ctx) => {
          const r = await appHooks?.user?.create?.before?.(user, ctx);
          if (r === false) return false;
          const base = r && typeof r === 'object' && 'data' in r ? r.data : user;
          const owner = env.MELDSTOCK_BOOTSTRAP_ADMIN_EMAIL?.toLowerCase();
          if (owner && user.email.toLowerCase() === owner) {
            return { data: { ...base, role: 'admin' } };
          }
          return r;
        },
      },
    },
  },
  plugins: [
    admin({
      defaultRole: 'user',
      adminRoles: ['admin'],
    }),
    ...(authConfig.plugins ?? []),
  ],
});
