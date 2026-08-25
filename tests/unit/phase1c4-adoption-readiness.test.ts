// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// @ts-expect-error The runtime helper is intentionally plain ESM for direct Node execution.
import * as adoption from '../../scripts/db/phase1c4-adoption-core.mjs';

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

function managedMigrations() {
  return adoption.EXPECTED_MIGRATIONS.map((migrationName: string) => ({
    migrationName,
    checksum: `checksum:${migrationName}`,
    finishedAt: new Date(),
    rolledBackAt: null,
    appliedStepsCount: 1,
  }));
}

function expectedChecksums() {
  return Object.fromEntries(
    adoption.EXPECTED_MIGRATIONS.map((migrationName: string) => [
      migrationName,
      `checksum:${migrationName}`,
    ]),
  );
}

describe('Phase 1C.4 existing-database adoption readiness', () => {
  it('pins the accepted physical inventory at 20 tables, 18 enums, and 4 migrations', () => {
    expect(adoption.EXPECTED_TABLES).toHaveLength(20);
    expect(adoption.EXPECTED_ENUMS).toHaveLength(18);
    expect(adoption.EXPECTED_MIGRATIONS).toHaveLength(4);
    expect(adoption.EXPECTED_TABLES).toEqual(
      expect.arrayContaining(['user', 'session', 'account', 'verification', 'Connection', 'Lot']),
    );
  });

  it('requires an explicit flag and the dedicated local PostgreSQL database', () => {
    const localUrl =
      'postgresql://postgres:postgres@localhost:5432/meldstock_phase1c4?schema=public';
    expect(adoption.validateAdoptionAuditTarget(localUrl, '1')).toBe(localUrl);
    expect(() => adoption.validateAdoptionAuditTarget(localUrl, undefined)).toThrow(
      'MELDSTOCK_DB_ADOPTION_AUDIT=1',
    );
    expect(() =>
      adoption.validateAdoptionAuditTarget(
        'postgresql://example.com:5432/meldstock_phase1c4?schema=public',
        '1',
      ),
    ).toThrow('localhost:5432/meldstock_phase1c4');
    expect(() =>
      adoption.validateAdoptionAuditTarget(
        'postgresql://postgres:postgres@localhost:5432/meldstock?schema=public',
        '1',
      ),
    ).toThrow('localhost:5432/meldstock_phase1c4');
    expect(() =>
      adoption.validateAdoptionAuditTarget(
        'postgresql://postgres:postgres@localhost:5432/meldstock_phase1c4?schema=public&host=example.com',
        '1',
      ),
    ).toThrow('localhost:5432/meldstock_phase1c4');
  });

  it('distinguishes empty, managed-current, unmanaged-complete, and divergent states', () => {
    const empty = adoption.classifyAdoptionState({
      tables: [],
      enums: [],
      migrations: [],
      migrationTablePresent: false,
      expectedMigrationChecksums: expectedChecksums(),
    });
    expect(empty.state).toBe('EMPTY_DATABASE');
    expect(adoption.adoptionAuditExitCode(empty.state)).toBe(0);

    const managed = adoption.classifyAdoptionState({
      tables: ['_prisma_migrations', ...adoption.EXPECTED_TABLES],
      enums: adoption.EXPECTED_ENUMS,
      migrations: managedMigrations(),
      migrationTablePresent: true,
      expectedMigrationChecksums: expectedChecksums(),
    });
    expect(managed.state).toBe('ALREADY_MANAGED_CURRENT');
    expect(managed.exactSchemaObjects).toBe(true);
    expect(managed.exactMigrationHistory).toBe(true);

    const unmanaged = adoption.classifyAdoptionState({
      tables: adoption.EXPECTED_TABLES,
      enums: adoption.EXPECTED_ENUMS,
      migrations: [],
      migrationTablePresent: false,
      expectedMigrationChecksums: expectedChecksums(),
    });
    expect(unmanaged.state).toBe('UNMANAGED_COMPLETE_REVIEW_REQUIRED');
    expect(adoption.adoptionAuditExitCode(unmanaged.state)).toBe(2);

    const divergent = adoption.classifyAdoptionState({
      tables: adoption.EXPECTED_TABLES.filter((table: string) => table !== 'Offer'),
      enums: adoption.EXPECTED_ENUMS,
      migrations: managedMigrations(),
      migrationTablePresent: true,
      expectedMigrationChecksums: expectedChecksums(),
    });
    expect(divergent.state).toBe('PARTIAL_OR_DIVERGENT_REVIEW_REQUIRED');
    expect(divergent.differences.missingTables).toEqual(['Offer']);
  });

  it('keeps the executable audit read-only and omits migration mutation commands', () => {
    const auditSource = read('scripts/db/phase1c4-adoption-audit.mjs');
    expect(auditSource).toContain("$executeRawUnsafe('SET TRANSACTION READ ONLY')");
    expect(auditSource).not.toMatch(
      /(?:^|\n)\s*(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)\b/i,
    );
    expect(auditSource).not.toMatch(/migrate\s+(?:deploy|resolve)|db\s+push/i);
  });
});
