export const ADOPTION_AUDIT_DATABASE = 'meldstock_phase1c4';

export const EXPECTED_TABLES = Object.freeze([
  'account',
  'AuditEvent',
  'Connection',
  'Document',
  'Lot',
  'LotMessage',
  'Message',
  'MessageThread',
  'Notification',
  'Offer',
  'Profile',
  'Rating',
  'SavedSearch',
  'session',
  'ThreadParticipant',
  'ThreadReadState',
  'user',
  'verification',
  'VerificationRequest',
  'WantedResponse',
]);

export const EXPECTED_ENUMS = Object.freeze([
  'BusinessRole',
  'ConnectionStatus',
  'DealStatus',
  'DocumentType',
  'FreightTerm',
  'LotCondition',
  'LotLifecycleStatus',
  'LotType',
  'LotVisibility',
  'NotificationKind',
  'OfferStatus',
  'Polymer',
  'PriceUnit',
  'RatingDimension',
  'ThreadKind',
  'TransactionStatus',
  'VerificationStatus',
  'WantedResponseStatus',
]);

export const EXPECTED_MIGRATIONS = Object.freeze([
  '20260603000000_init_better_auth',
  '20260612000000_add_better_auth_admin',
  '20260817000000_connection_request_accept',
  '20260825000000_marketplace_baseline',
]);

function sorted(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function difference(left, right) {
  const rightSet = new Set(right);
  return sorted(left.filter((value) => !rightSet.has(value)));
}

export function validateAdoptionAuditTarget(databaseUrl, auditFlag) {
  if (auditFlag !== '1') {
    throw new Error('MELDSTOCK_DB_ADOPTION_AUDIT=1 is required');
  }

  if (!databaseUrl) {
    throw new Error('DATABASE_URL must be explicitly provided');
  }

  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL');
  }

  const databaseName = decodeURIComponent(parsed.pathname.slice(1));
  const schema = parsed.searchParams.get('schema');
  const connectionParameters = [...parsed.searchParams.entries()];
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    !['localhost', '127.0.0.1'].includes(parsed.hostname) ||
    parsed.port !== '5432' ||
    databaseName !== ADOPTION_AUDIT_DATABASE ||
    (schema !== null && schema !== 'public') ||
    connectionParameters.length > (schema === null ? 0 : 1) ||
    connectionParameters.some(([key]) => key !== 'schema')
  ) {
    throw new Error(
      `The adoption audit only accepts PostgreSQL localhost:5432/${ADOPTION_AUDIT_DATABASE} with the public schema`,
    );
  }

  return databaseUrl;
}

export function classifyAdoptionState({
  tables,
  enums,
  migrations,
  migrationTablePresent,
  expectedMigrationChecksums,
}) {
  const userTables = sorted(tables.filter((table) => table !== '_prisma_migrations'));
  const enumNames = sorted(enums);
  const migrationNames = sorted(migrations.map((migration) => migration.migrationName));

  const missingTables = difference(EXPECTED_TABLES, userTables);
  const unexpectedTables = difference(userTables, EXPECTED_TABLES);
  const missingEnums = difference(EXPECTED_ENUMS, enumNames);
  const unexpectedEnums = difference(enumNames, EXPECTED_ENUMS);
  const missingMigrations = difference(EXPECTED_MIGRATIONS, migrationNames);
  const unexpectedMigrations = difference(migrationNames, EXPECTED_MIGRATIONS);

  const migrationsByName = new Map(
    migrations.map((migration) => [migration.migrationName, migration]),
  );
  const checksumMismatches = EXPECTED_MIGRATIONS.filter((name) => {
    const migration = migrationsByName.get(name);
    const expectedChecksum = expectedMigrationChecksums[name];
    return migration && expectedChecksum && migration.checksum !== expectedChecksum;
  });
  const incompleteMigrations = EXPECTED_MIGRATIONS.filter((name) => {
    const migration = migrationsByName.get(name);
    return (
      migration &&
      (!migration.finishedAt || migration.rolledBackAt || migration.appliedStepsCount < 1)
    );
  });

  const exactSchemaObjects =
    missingTables.length === 0 &&
    unexpectedTables.length === 0 &&
    missingEnums.length === 0 &&
    unexpectedEnums.length === 0;
  const exactMigrationHistory =
    migrationTablePresent &&
    missingMigrations.length === 0 &&
    unexpectedMigrations.length === 0 &&
    checksumMismatches.length === 0 &&
    incompleteMigrations.length === 0;

  let state;
  let safeNextStep;
  if (userTables.length === 0 && enumNames.length === 0 && migrations.length === 0) {
    state = 'EMPTY_DATABASE';
    safeNextStep =
      'The disposable target is empty and is eligible for the already-reviewed fresh migration proof.';
  } else if (exactSchemaObjects && exactMigrationHistory) {
    state = 'ALREADY_MANAGED_CURRENT';
    safeNextStep =
      'No adoption marking is needed. Continue with ordinary read-only migration status and drift checks.';
  } else if (exactSchemaObjects && (!migrationTablePresent || migrations.length === 0)) {
    state = 'UNMANAGED_COMPLETE_REVIEW_REQUIRED';
    safeNextStep =
      'Stop. Review an isolated clone object-by-object before approving any migration-history marking.';
  } else {
    state = 'PARTIAL_OR_DIVERGENT_REVIEW_REQUIRED';
    safeNextStep =
      'Stop. Produce a reviewed reconciliation plan on an isolated clone; do not apply baseline table-creation SQL.';
  }

  return {
    state,
    safeNextStep,
    exactSchemaObjects,
    exactMigrationHistory,
    differences: {
      missingTables,
      unexpectedTables,
      missingEnums,
      unexpectedEnums,
      missingMigrations,
      unexpectedMigrations,
      checksumMismatches: sorted(checksumMismatches),
      incompleteMigrations: sorted(incompleteMigrations),
    },
  };
}

export function adoptionAuditExitCode(state) {
  return ['EMPTY_DATABASE', 'ALREADY_MANAGED_CURRENT'].includes(state) ? 0 : 2;
}
