import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Phase 1C.3 migration baseline', () => {
  it('commits the marketplace baseline migration after the accepted migrations', () => {
    expect(existsSync('prisma/migrations/20260825000000_marketplace_baseline/migration.sql')).toBe(
      true,
    );
  });
});
