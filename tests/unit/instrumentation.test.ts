// @vitest-environment node
// Locks the framework invariants of the server-startup seed hook
// (src/instrumentation.ts): the Node-runtime guard and fail-open behavior. The
// agent's seed body lives in src/lib/seed.ts and is mocked here — this test is
// about the envelope, not the seed content, and needs no database.
import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_RUNTIME = process.env.NEXT_RUNTIME;
const ORIGINAL_SEED = process.env.ENABLE_DEMO_SEED;

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  if (ORIGINAL_RUNTIME === undefined) delete process.env.NEXT_RUNTIME;
  else process.env.NEXT_RUNTIME = ORIGINAL_RUNTIME;
  if (ORIGINAL_SEED === undefined) delete process.env.ENABLE_DEMO_SEED;
  else process.env.ENABLE_DEMO_SEED = ORIGINAL_SEED;
});

describe('instrumentation register()', () => {
  it('does NOT run the seed outside the Node.js runtime (edge guard)', async () => {
    process.env.NEXT_RUNTIME = 'edge';
    const seed = vi.fn().mockResolvedValue(undefined);
    vi.doMock('@/lib/seed', () => ({ seed }));

    const { register } = await import('@/instrumentation');
    await expect(register()).resolves.toBeUndefined();
    expect(seed).not.toHaveBeenCalled();
  });

  it('does not seed on ordinary Node.js startup', async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    const seed = vi.fn().mockResolvedValue(undefined);
    vi.doMock('@/lib/seed', () => ({ seed }));

    const { register } = await import('@/instrumentation');
    await register();
    expect(seed).not.toHaveBeenCalled();
  });

  it('runs only when opted in and remains fail-open', async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    process.env.ENABLE_DEMO_SEED = '1';
    const seed = vi.fn().mockRejectedValue(new Error('seed boom'));
    vi.doMock('@/lib/seed', () => ({ seed }));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { register } = await import('@/instrumentation');
    await expect(register()).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });
});
