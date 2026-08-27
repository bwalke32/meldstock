// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { issueAttachmentToken, resolveAttachmentToken } from '@/lib/security/attachment-token';
import { DisabledAiService, OpenAiService } from '@/lib/services/ai';
import { NoopAnalyticsService } from '@/lib/services/analytics';
import { LocalMailService } from '@/lib/services/mail';
import { LocalObjectStorage } from '@/lib/services/storage';

afterEach(() => vi.restoreAllMocks());

describe('Phase 1C.1 local providers', () => {
  it('local mail records sanitized metadata without making a network call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await new LocalMailService().send({
      to: 'private@example.test',
      subject: 'Reset',
      html: '<p>secret body</p>',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('local storage uses opaque keys and rejects path/user URL input', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'meldstock-storage-'));
    try {
      const storage = new LocalObjectStorage(root);
      const stored = await storage.put({
        bytes: Buffer.from('private'),
        filename: '../../coa.pdf',
        mimeType: 'application/pdf',
      });
      expect(stored.key).toMatch(/^local:v1:[0-9a-f-]{36}$/);
      expect(stored.key).not.toContain('coa.pdf');
      expect((await storage.get(stored.key)).bytes.toString()).toBe('private');
      await expect(storage.get('https://attacker.test/file')).rejects.toThrow(
        'Invalid storage key',
      );
      const token = issueAttachmentToken(
        {
          upstreamUrl: stored.key,
          uploadedBy: 'user-a',
          filename: stored.filename,
          mimeType: stored.mimeType,
        },
        'test-secret',
      );
      expect(resolveAttachmentToken(token, { secret: 'test-secret' }).upstreamUrl).toBe(stored.key);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('disabled AI and no-op analytics are startup-safe and make no network call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(new DisabledAiService().complete({ messages: [] })).rejects.toThrow(
      'AI is not configured',
    );
    await expect(new NoopAnalyticsService().record({ name: 'page_view' })).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('Phase 1C.1 independently invokable scheduled job', () => {
  it('runs stale-nudge business logic with injected database and mail services', async () => {
    const require = createRequire(import.meta.url);
    const { runStaleNudge } = require('../../jobs/stale-nudge.js') as {
      runStaleNudge: (input: unknown) => Promise<void>;
    };
    const prisma = {
      lot: { findMany: vi.fn().mockResolvedValue([]) },
      user: { findMany: vi.fn() },
    };
    const mail = { send: vi.fn() };
    await runStaleNudge({ prisma, mail, now: Date.now(), appUrl: 'http://localhost:3000' });
    expect(mail.send).not.toHaveBeenCalled();
  });
});

describe('independent OpenAI provider', () => {
  it('uses Responses structured output without storing the request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      Response.json({
        output: [{ content: [{ type: 'output_text', text: '{"material":"PA66"}' }] }],
      }),
    );
    const service = new OpenAiService('server-key');

    const output = await service.complete({
      model: 'gpt-4o-mini',
      task: 'material-intake',
      messages: [{ role: 'user', content: 'Need PA66' }],
      responseFormat: {
        type: 'json_schema',
        name: 'material_intake',
        schema: { type: 'object', additionalProperties: false },
        strict: true,
      },
    });

    expect(output).toBe('{"material":"PA66"}');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.openai.com/v1/responses',
      expect.objectContaining({ method: 'POST', cache: 'no-store' }),
    );
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body.store).toBe(false);
    expect(body.text.format).toMatchObject({ type: 'json_schema', name: 'material_intake' });
    expect(body.metadata).toEqual({ task: 'material-intake' });
    expect(JSON.stringify(body)).not.toContain('server-key');
  });
});
