import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// biome-ignore lint/style/noRestrictedImports: This guarded operator audit intentionally creates an isolated client for its dedicated local database.
import { PrismaClient } from '@prisma/client';
import {
  adoptionAuditExitCode,
  classifyAdoptionState,
  EXPECTED_MIGRATIONS,
  validateAdoptionAuditTarget,
} from './phase1c4-adoption-core.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const datasourceUrl = validateAdoptionAuditTarget(
  process.env.DATABASE_URL,
  process.env.MELDSTOCK_DB_ADOPTION_AUDIT,
);

function expectedMigrationChecksums() {
  return Object.fromEntries(
    EXPECTED_MIGRATIONS.map((migrationName) => {
      const sql = readFileSync(
        path.join(repositoryRoot, 'prisma', 'migrations', migrationName, 'migration.sql'),
        'utf8',
      );
      return [migrationName, createHash('sha256').update(sql).digest('hex')];
    }),
  );
}

const prisma = new PrismaClient({ datasourceUrl });

try {
  const inventory = await prisma.$transaction(
    async (transaction) => {
      // PostgreSQL transaction-control statements cannot be sent as prepared
      // statements. This is a fixed literal with no user-controlled input.
      await transaction.$executeRawUnsafe('SET TRANSACTION READ ONLY');

      const [database] = await transaction.$queryRaw`
        SELECT
          current_database() AS "databaseName",
          current_schema() AS "schemaName",
          current_setting('server_version') AS "serverVersion"
      `;
      const tables = await transaction.$queryRaw`
        SELECT table_name AS "tableName"
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name
      `;
      const enums = await transaction.$queryRaw`
        SELECT
          type.typname AS "enumName",
          value.enumlabel AS "enumValue",
          value.enumsortorder::float8 AS "sortOrder"
        FROM pg_type AS type
        JOIN pg_namespace AS namespace ON namespace.oid = type.typnamespace
        JOIN pg_enum AS value ON value.enumtypid = type.oid
        WHERE namespace.nspname = 'public'
        ORDER BY type.typname, value.enumsortorder
      `;
      const columns = await transaction.$queryRaw`
        SELECT
          table_name AS "tableName",
          column_name AS "columnName",
          ordinal_position AS "ordinalPosition",
          data_type AS "dataType",
          udt_name AS "underlyingType",
          is_nullable AS "isNullable",
          column_default AS "columnDefault"
        FROM information_schema.columns
        WHERE table_schema = 'public'
        ORDER BY table_name, ordinal_position
      `;
      const constraints = await transaction.$queryRaw`
        SELECT
          relation.relname AS "tableName",
          constraint_name.conname AS "constraintName",
          constraint_name.contype AS "constraintType",
          pg_get_constraintdef(constraint_name.oid) AS "definition"
        FROM pg_constraint AS constraint_name
        JOIN pg_class AS relation ON relation.oid = constraint_name.conrelid
        JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'public'
        ORDER BY relation.relname, constraint_name.conname
      `;
      const indexes = await transaction.$queryRaw`
        SELECT
          tablename AS "tableName",
          indexname AS "indexName",
          indexdef AS "definition"
        FROM pg_indexes
        WHERE schemaname = 'public'
        ORDER BY tablename, indexname
      `;
      const [migrationTable] = await transaction.$queryRaw`
        SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS "present"
      `;
      const migrations = migrationTable?.present
        ? await transaction.$queryRaw`
            SELECT
              migration_name AS "migrationName",
              checksum,
              finished_at AS "finishedAt",
              rolled_back_at AS "rolledBackAt",
              applied_steps_count AS "appliedStepsCount"
            FROM "_prisma_migrations"
            ORDER BY started_at
          `
        : [];

      return {
        database,
        tables,
        enums,
        columns,
        constraints,
        indexes,
        migrationTablePresent: Boolean(migrationTable?.present),
        migrations,
      };
    },
    { isolationLevel: 'RepeatableRead', timeout: 30_000 },
  );

  const enumNames = inventory.enums.map((entry) => entry.enumName);
  const classification = classifyAdoptionState({
    tables: inventory.tables.map((entry) => entry.tableName),
    enums: enumNames,
    migrations: inventory.migrations,
    migrationTablePresent: inventory.migrationTablePresent,
    expectedMigrationChecksums: expectedMigrationChecksums(),
  });
  const report = {
    reportVersion: 1,
    generatedAt: new Date().toISOString(),
    safety: {
      transactionMode: 'READ ONLY',
      rowDataRead: false,
      targetRestriction: 'localhost:5432/meldstock_phase1c4?schema=public',
    },
    database: inventory.database,
    classification,
    inventory: {
      tables: inventory.tables,
      enums: inventory.enums,
      columns: inventory.columns,
      constraints: inventory.constraints,
      indexes: inventory.indexes,
      migrationTablePresent: inventory.migrationTablePresent,
      migrations: inventory.migrations,
    },
  };

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = adoptionAuditExitCode(classification.state);
} finally {
  await prisma.$disconnect();
}
