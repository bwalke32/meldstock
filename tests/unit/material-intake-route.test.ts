// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MaterialIntakeExtraction } from '@/lib/contracts/material-intake';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  checkLimit: vi.fn(),
  generateStructuredObject: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/require-auth', () => ({ requireAuth: mocks.requireAuth }));
vi.mock('@/lib/security/rate-limit', () => ({
  checkLimit: mocks.checkLimit,
  rateBucketFor: (_req: Request, userId: string, suffix: string) => `u:${userId}:${suffix}`,
}));
vi.mock('@/lib/ai/client', () => ({
  generateStructuredObject: mocks.generateStructuredObject,
}));

import { POST } from '@/app/api/ai/material-intake/route';

const EXTRACTION: MaterialIntakeExtraction = {
  material: 'SABIC CYCOLOY C6600 Black',
  manufacturer: 'SABIC',
  grade: 'CYCOLOY C6600',
  polymer: 'PC',
  condition: 'PRIME_VIRGIN',
  color: 'Black',
  quantityLb: 5_000,
  destination: 'Chicago, IL',
  country: 'USA',
  neededBy: '2026-09-30',
  equivalentAllowed: true,
  flameRating: 'UL94 V-0',
  glassFiberPercent: null,
  meltFlow: null,
  application: 'Electrical enclosure',
  packaging: null,
  annualUsageLb: null,
  certifications: ['UL94 V-0'],
  notes: [],
  cautions: [],
};

function request(body: unknown) {
  return new Request('http://localhost/api/ai/material-intake', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('AI material intake boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({ id: 'user-a' });
    mocks.checkLimit.mockReturnValue({ allowed: true });
    mocks.generateStructuredObject.mockResolvedValue(EXTRACTION);
  });

  it('denies anonymous analysis before a provider call', async () => {
    mocks.requireAuth.mockRejectedValueOnce(
      Response.json({ error: 'Unauthorized' }, { status: 401 }),
    );
    const response = await POST(request({ requestText: 'Need 5,000 lbs of black PC ABS' }));

    expect(response.status).toBe(401);
    expect(mocks.generateStructuredObject).not.toHaveBeenCalled();
  });

  it('uses the fixed material-intake task and returns a validated editable draft', async () => {
    const response = await POST(
      request({
        requestText:
          'Need 5,000 lbs of black PC ABS prime delivered to Chicago, IL by 2026-09-30. Equivalents acceptable.',
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.engine).toBe('ai');
    expect(body.draft).toMatchObject({ quantityLb: 5_000, destination: 'Chicago, IL' });
    expect(mocks.generateStructuredObject).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-4o-mini',
        task: 'material-intake',
        schemaName: 'meldstock_material_intake',
        maxOutputTokens: 900,
      }),
    );
  });

  it('falls back locally without leaking provider errors', async () => {
    mocks.generateStructuredObject.mockRejectedValueOnce(
      new Error('Bearer secret-provider-key timed out'),
    );
    const response = await POST(
      request({ requestText: 'Need 2,204 lbs of PA66 GF33 black delivered to Joliet, IL.' }),
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('deterministic');
    expect(body).not.toContain('secret-provider-key');
    expect(body).not.toContain('timed out');
  });

  it('rate-limits before a metered provider call', async () => {
    mocks.checkLimit.mockReturnValueOnce({ allowed: false, retryAfterMs: 45_000 });
    const response = await POST(request({ requestText: 'Need 5,000 lbs of black PC ABS' }));

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('45');
    expect(mocks.generateStructuredObject).not.toHaveBeenCalled();
  });

  it('rejects client attempts to select a model or task', async () => {
    const response = await POST(
      request({ requestText: 'Need 5,000 lbs of black PC ABS', model: 'expensive-model' }),
    );

    expect(response.status).toBe(400);
    expect(mocks.generateStructuredObject).not.toHaveBeenCalled();
  });
});
