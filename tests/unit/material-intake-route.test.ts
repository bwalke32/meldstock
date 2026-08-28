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
    mocks.generateStructuredObject.mockResolvedValue({
      items: [{ sourceText: 'Need 5,000 lbs of black PC ABS', ...EXTRACTION }],
    });
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
    expect(body.items).toHaveLength(1);
    expect(body.items[0].draft).toMatchObject({ quantityLb: 5_000, destination: 'Chicago, IL' });
    expect(mocks.generateStructuredObject).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-4o-mini',
        task: 'material-intake',
        schemaName: 'meldstock_material_intake_batch',
        maxOutputTokens: 1800,
      }),
    );
  });

  it('returns independent editable drafts for two material needs', async () => {
    mocks.generateStructuredObject.mockResolvedValueOnce({
      items: [
        {
          sourceText:
            'Need 5,000/lbs. of Regrind ABS Injection-Grade Natural ASAP, FOB point is Romeoville, IL.',
          ...EXTRACTION,
          material: 'ABS Injection-Grade',
          polymer: 'ABS',
          condition: 'REGRIND_GRANULATED',
          color: 'Natural',
          destination: 'Romeoville, IL',
          neededBy: null,
        },
        {
          sourceText:
            'Also looking for ~10-20k/lbs. of Regrind, PC Injection Grade 112 Blue-Tint Clear delivered to Romeoville, Illinois.',
          ...EXTRACTION,
          material: 'PC Injection Grade 112',
          polymer: 'PC',
          condition: 'REGRIND_GRANULATED',
          color: 'Blue-Tint Clear',
          quantityLb: 10_000,
          destination: 'Romeoville, Illinois',
          neededBy: null,
        },
      ],
    });

    const response = await POST(
      request({
        requestText:
          'Need 5,000/lbs. of Regrind ABS Injection-Grade Natural ASAP, FOB point is Romeoville, IL. Also looking for ~10-20k/lbs. of Regrind, PC Injection Grade 112 Blue-Tint Clear delivered to Romeoville, Illinois.',
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.items).toHaveLength(2);
    expect(body.items[0].draft).toMatchObject({
      material: 'ABS Injection-Grade',
      quantityLb: 5_000,
      condition: 'REGRIND_GRANULATED',
    });
    expect(body.items[1].draft).toMatchObject({
      material: 'PC Injection Grade 112',
      quantityLb: 10_000,
      condition: 'REGRIND_GRANULATED',
    });
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
