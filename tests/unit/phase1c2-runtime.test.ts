// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createServices } from '@/lib/services';
import { PolsiaObjectStorage } from '@/lib/services/storage';

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

describe('Phase 1C.2 independent runtime', () => {
  it('has no schema-push or data-loss command in active runtime scripts', () => {
    const scripts = JSON.parse(read('package.json')).scripts as Record<string, string>;
    const activeCommands = Object.values(scripts).join('\n');
    expect(activeCommands).not.toMatch(/prisma\s+db\s+push/i);
    expect(activeCommands).not.toContain('--accept-data-loss');
  });

  it('uses migration deploy and does not expose the archived manifest at the runtime root', () => {
    const scripts = JSON.parse(read('package.json')).scripts as Record<string, string>;
    expect(scripts['db:migrate:deploy']).toBe('prisma migrate deploy');
    expect(() => read('polsia.toml')).toThrow();
    expect(Object.values(scripts).join('\n')).not.toContain('polsia.toml');
  });

  it('keeps the server environment module out of the client navigation bundle', () => {
    const navigation = read('src/components/custom/site-nav.tsx');
    expect(navigation).toContain("from '@/lib/brand'");
    expect(navigation).not.toContain("from '@/lib/site'");
  });

  it('keeps core provider defaults Polsia-independent', () => {
    const services = createServices({ NODE_ENV: 'test' });
    expect(services.mail.constructor.name).toBe('LocalMailService');
    expect(services.storage.constructor.name).toBe('LocalObjectStorage');
    expect(services.ai.constructor.name).toBe('DisabledAiService');
    expect(services.analytics.constructor.name).toBe('NoopAnalyticsService');
  });

  it('rejects arbitrary remote legacy storage URLs before fetching', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const storage = new PolsiaObjectStorage(
      'https://upload.legacy.example/put',
      'test-key',
      'https://objects.legacy.example',
    );
    await expect(storage.get('https://attacker.example/private')).rejects.toThrow(
      'Untrusted legacy storage reference',
    );
    await expect(storage.get('http://objects.legacy.example/private')).rejects.toThrow(
      'Untrusted legacy storage reference',
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
