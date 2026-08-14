// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  streamChat: vi.fn(),
  checkLimit: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/require-auth', () => ({ requireAuth: mocks.requireAuth }));
vi.mock('@/lib/security/rate-limit', () => ({
  checkLimit: mocks.checkLimit,
  rateBucketFor: (_req: Request, userId: string, suffix: string) => `u:${userId}:${suffix}`,
}));
vi.mock('@/lib/ai/client', () => {
  class AiConfigurationError extends Error {}
  return { AiConfigurationError, streamChat: mocks.streamChat };
});

import { POST } from '@/app/api/ai/chat/route';

function request(body: unknown) {
  return new Request('http://localhost/api/ai/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('Phase 1A AI boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({ id: 'user-a' });
    mocks.checkLimit.mockReturnValue({ allowed: true });
    mocks.streamChat.mockResolvedValue(
      new Response('data: done\n\n', { headers: { 'content-type': 'text/event-stream' } }),
    );
  });

  it('denies anonymous requests before reaching the provider', async () => {
    mocks.requireAuth.mockRejectedValueOnce(
      Response.json({ error: 'Unauthorized' }, { status: 401 }),
    );
    const response = await POST(request({ messages: [{ role: 'user', content: 'Help' }] }));
    expect(response.status).toBe(401);
    expect(mocks.streamChat).not.toHaveBeenCalled();
  });

  it('lets authenticated requests reach only the protected Meldstock task and model', async () => {
    const response = await POST(request({ messages: [{ role: 'user', content: 'Explain MFI' }] }));
    expect(response.status).toBe(200);
    expect(mocks.streamChat).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-4o-mini', task: 'meldstock-assistant' }),
    );
  });

  it('rate-limits a user before a metered provider call', async () => {
    mocks.checkLimit.mockReturnValueOnce({ allowed: false, retryAfterMs: 30_000 });
    const response = await POST(request({ messages: [{ role: 'user', content: 'Help' }] }));
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('30');
    expect(mocks.streamChat).not.toHaveBeenCalled();
  });

  it('does not leak provider errors or credential-like details', async () => {
    mocks.streamChat.mockRejectedValueOnce(new Error('Bearer super-secret-key provider trace'));
    const response = await POST(request({ messages: [{ role: 'user', content: 'Help' }] }));
    const body = await response.text();
    expect(response.status).toBe(502);
    expect(body).toContain('ai_unavailable');
    expect(body).not.toContain('super-secret-key');
    expect(body).not.toContain('provider trace');
  });
});
