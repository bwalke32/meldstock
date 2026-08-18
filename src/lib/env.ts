// @polsia:shared — edit only through declared slots. Code installed by polsia/template-next@0.3.0.
//
// Typed env via @t3-oss/env-nextjs.
//
// Modules contribute env vars via their manifest `contributions` block.
// The installer regenerates this file's slots between the markers below.
// Hand-editing outside those slots is rejected by the ownership validator.
//
// The `no-secrets-in-client-bundle` validator scans the build output and rejects
// the install if any non-NEXT_PUBLIC_ env name appears in client chunks.

import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

export const env = createEnv({
  server: {
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    // D24: Prisma is the framework-native DB client. DATABASE_URL is
    // injected by Polsia at deploy time (D23). The actual Postgres is
    // provisioned by a separate Polsia service; this module ships the
    // client only.
    DATABASE_URL: z.string().url(),
    // @polsia:slot env_vars_server start
    // Modules append additional server-side env vars here at install time.
    // @polsia:contrib better-auth start
    BETTER_AUTH_SECRET: z.string().min(1),
    BETTER_AUTH_URL: z.string().url(),
    BETTER_AUTH_TRUSTED_ORIGINS: z.string().optional(),
    MELDSTOCK_BOOTSTRAP_ADMIN_EMAIL: z.string().email().optional(),
    // @polsia:contrib better-auth end
    // @polsia:contrib email start
    MAIL_PROVIDER: z.enum(['local', 'polsia']).default('local'),
    STORAGE_PROVIDER: z.enum(['local', 'polsia']).default('local'),
    AI_PROVIDER: z.enum(['disabled', 'polsia']).default('disabled'),
    ANALYTICS_PROVIDER: z.enum(['disabled', 'polsia']).default('disabled'),
    SCHEDULER_PROVIDER: z.enum(['manual', 'polsia']).default('manual'),
    ENABLE_DEMO_SEED: z.enum(['0', '1']).default('0'),
    LOCAL_STORAGE_PATH: z.string().optional(),
    POLSIA_EMAIL_PROXY_URL: z.string().url().optional(),
    POLSIA_STORAGE_UPLOAD_URL: z.string().url().optional(),
    POLSIA_LEGACY_STORAGE_ORIGINS: z.string().optional(),
    // @polsia:contrib email end
    POLSIA_API_KEY: z.string().min(1).optional(),
    // @polsia:contrib ai start
    POLSIA_AI_BASE_URL: z.string().url().optional(),
    POLSIA_API_TOKEN: z.string().min(1).optional(),
    POLSIA_ANALYTICS_SLUG: z.string().min(1).optional(),
    POLSIA_API_BASE_URL: z.string().url().optional(),
    // @polsia:contrib ai end
    // @polsia:slot env_vars_server end
  },

  client: {
    NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
    // Base for @/lib/api-client + proxy.ts connect-src. Default-empty
    // (unset) means same-origin `/api`; set only for an external API origin.
    NEXT_PUBLIC_API_URL: z.string().url().optional(),
    // @polsia:slot env_vars_client start
    // Modules append NEXT_PUBLIC_* env vars here at install time.
    // @polsia:slot env_vars_client end
  },

  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    // @polsia:slot env_runtime start
    // Modules append runtime-env entries here at install time.
    // @polsia:contrib better-auth start
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    BETTER_AUTH_TRUSTED_ORIGINS: process.env.BETTER_AUTH_TRUSTED_ORIGINS,
    MELDSTOCK_BOOTSTRAP_ADMIN_EMAIL: process.env.MELDSTOCK_BOOTSTRAP_ADMIN_EMAIL,
    MAIL_PROVIDER: process.env.MAIL_PROVIDER,
    STORAGE_PROVIDER: process.env.STORAGE_PROVIDER,
    AI_PROVIDER: process.env.AI_PROVIDER,
    ANALYTICS_PROVIDER: process.env.ANALYTICS_PROVIDER,
    SCHEDULER_PROVIDER: process.env.SCHEDULER_PROVIDER,
    ENABLE_DEMO_SEED: process.env.ENABLE_DEMO_SEED,
    LOCAL_STORAGE_PATH: process.env.LOCAL_STORAGE_PATH,
    // @polsia:contrib better-auth end
    // @polsia:contrib email start
    POLSIA_EMAIL_PROXY_URL: process.env.POLSIA_EMAIL_PROXY_URL,
    POLSIA_STORAGE_UPLOAD_URL: process.env.POLSIA_STORAGE_UPLOAD_URL,
    POLSIA_LEGACY_STORAGE_ORIGINS: process.env.POLSIA_LEGACY_STORAGE_ORIGINS,
    // @polsia:contrib email end
    POLSIA_API_KEY: process.env.POLSIA_API_KEY,
    // @polsia:contrib ai start
    POLSIA_AI_BASE_URL: process.env.POLSIA_AI_BASE_URL,
    POLSIA_API_TOKEN: process.env.POLSIA_API_TOKEN,
    POLSIA_ANALYTICS_SLUG: process.env.POLSIA_ANALYTICS_SLUG,
    POLSIA_API_BASE_URL: process.env.POLSIA_API_BASE_URL,
    // @polsia:contrib ai end
    // @polsia:slot env_runtime end
  },
  emptyStringAsUndefined: true,
  // SKIP_ENV_VALIDATION=1 bypasses validation for envless builds (lint/CI/local).
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});

function requireProviderValues(provider: string, values: Array<[string, string | undefined]>) {
  const missing = values.filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) throw new Error(`${provider} provider requires: ${missing.join(', ')}`);
}

if (!process.env.SKIP_ENV_VALIDATION) {
  if (env.MAIL_PROVIDER === 'polsia')
    requireProviderValues('Polsia mail', [
      ['POLSIA_EMAIL_PROXY_URL', env.POLSIA_EMAIL_PROXY_URL],
      ['POLSIA_API_KEY', env.POLSIA_API_KEY],
    ]);
  if (env.STORAGE_PROVIDER === 'polsia')
    requireProviderValues('Polsia storage', [
      ['POLSIA_STORAGE_UPLOAD_URL', env.POLSIA_STORAGE_UPLOAD_URL],
      ['POLSIA_API_KEY', env.POLSIA_API_KEY],
      ['POLSIA_LEGACY_STORAGE_ORIGINS', env.POLSIA_LEGACY_STORAGE_ORIGINS],
    ]);
  if (env.AI_PROVIDER === 'polsia')
    requireProviderValues('Polsia AI', [
      ['POLSIA_AI_BASE_URL', env.POLSIA_AI_BASE_URL],
      ['POLSIA_API_KEY or POLSIA_API_TOKEN', env.POLSIA_API_KEY ?? env.POLSIA_API_TOKEN],
    ]);
  if (env.ANALYTICS_PROVIDER === 'polsia')
    requireProviderValues('Polsia analytics', [
      ['POLSIA_API_BASE_URL', env.POLSIA_API_BASE_URL],
      ['POLSIA_ANALYTICS_SLUG', env.POLSIA_ANALYTICS_SLUG],
    ]);
}
