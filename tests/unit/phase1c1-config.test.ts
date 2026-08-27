// @vitest-environment node
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.resetModules();
});

async function loadEnv(extra: Record<string, string | undefined> = {}) {
  process.env = {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://localhost:5432/meldstock',
    BETTER_AUTH_SECRET: 'test-secret',
    BETTER_AUTH_URL: 'http://localhost:3000',
    ...extra,
  };
  for (const key of Object.keys(process.env))
    if (key.startsWith('POLSIA_') && !(key in extra)) delete process.env[key];
  vi.resetModules();
  return import('@/lib/env');
}

describe('Phase 1C.1 configuration', () => {
  it('validates core startup with zero POLSIA variables and disabled/local defaults', async () => {
    const { env } = await loadEnv();
    expect(env.MAIL_PROVIDER).toBe('local');
    expect(env.STORAGE_PROVIDER).toBe('local');
    expect(env.AI_PROVIDER).toBe('disabled');
    expect(env.ANALYTICS_PROVIDER).toBe('disabled');
  });

  it('requires only relevant variables when a Polsia provider is selected', async () => {
    await expect(loadEnv({ MAIL_PROVIDER: 'polsia' })).rejects.toThrow(/POLSIA_EMAIL_PROXY_URL/);
    await expect(
      loadEnv({
        MAIL_PROVIDER: 'polsia',
        POLSIA_EMAIL_PROXY_URL: 'https://mail.example.test',
        POLSIA_API_KEY: 'key',
      }),
    ).resolves.toBeDefined();
  });

  it('requires an API key only when the independent OpenAI adapter is selected', async () => {
    await expect(loadEnv({ AI_PROVIDER: 'openai' })).rejects.toThrow(/OPENAI_API_KEY/);
    await expect(
      loadEnv({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'local-test-key' }),
    ).resolves.toBeDefined();
  });

  it('auth contains no automatic Polsia origins and uses generic admin bootstrap', () => {
    const source = readFileSync(new URL('../../src/lib/auth.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('*.polsia.app');
    expect(source).not.toContain('POLSIA_OWNER_EMAIL');
    expect(source).toContain('MELDSTOCK_BOOTSTRAP_ADMIN_EMAIL');
  });
});
