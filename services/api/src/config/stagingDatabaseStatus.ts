import { readFileSync } from 'node:fs';
export const STAGING_PROJECT_REFERENCE = 'apytozlgrnycswqgnanb';
export const STAGING_CA_CERTIFICATE_PATH = 'C:\\Users\\Kushwaha\\Downloads\\prod-ca-2021.crt';

export interface StagingDatabaseTarget {
  connectionString: string;
  ca: Buffer;
}

export interface StagingDatabaseStatus {
  database: string;
  role: string;
  migrationLedgerExists: boolean;
  appliedMigrations: Array<{ name: string; appliedAt: string }>;
  publicTables: string[];
}

export function validateStagingDatabaseUrl(connectionString: string | undefined): string {
  if (!connectionString) {
    throw new Error('DATABASE_URL must be explicitly supplied in the process environment.');
  }

  let target: URL;
  try {
    target = new URL(connectionString);
  } catch {
    throw new Error('DATABASE_URL is not a valid PostgreSQL connection URL.');
  }

  if (!['postgres:', 'postgresql:'].includes(target.protocol)) {
    throw new Error('DATABASE_URL must use the PostgreSQL protocol.');
  }

  let username: string;
  let password: string;
  try {
    username = decodeURIComponent(target.username);
    password = decodeURIComponent(target.password);
  } catch {
    throw new Error('DATABASE_URL contains invalid encoded credentials.');
  }

  if (!password) {
    throw new Error('DATABASE_URL must include a password.');
  }

  if (
    !/^[a-z0-9-]+\.pooler\.supabase\.com$/.test(target.hostname.toLowerCase()) ||
    target.port !== '5432' ||
    username !== `postgres.${STAGING_PROJECT_REFERENCE}`
  ) {
    throw new Error('DATABASE_URL does not target the expected Supabase staging session pooler.');
  }

  const sslParameters = [...target.searchParams.entries()].filter(([key]) =>
    key.toLowerCase().startsWith('ssl'),
  );
  if (
    sslParameters.some(
      ([key, value]) => key.toLowerCase() !== 'sslmode' || value.toLowerCase() !== 'require',
    ) ||
    sslParameters.filter(([key]) => key.toLowerCase() === 'sslmode').length > 1
  ) {
    throw new Error('DATABASE_URL contains unsupported SSL URL parameters.');
  }

  for (const [key] of sslParameters) {
    target.searchParams.delete(key);
  }

  return target.toString();
}

export function createStagingDatabaseTarget(
  connectionString: string | undefined,
  caCertificatePath = STAGING_CA_CERTIFICATE_PATH,
): StagingDatabaseTarget {
  const validatedConnectionString = validateStagingDatabaseUrl(connectionString);
  let ca: Buffer;
  try {
    ca = readFileSync(caCertificatePath);
  } catch {
    throw new Error('The configured staging CA certificate could not be read.');
  }

  return { connectionString: validatedConnectionString, ca };
}

interface StatusQueryClient {
  query(statement: string): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export async function readStagingDatabaseStatus(
  client: StatusQueryClient,
): Promise<StagingDatabaseStatus> {
  await client.query('BEGIN TRANSACTION READ ONLY');
  try {
    const identityResult = await client.query(
      'SELECT current_database() AS database_name, current_user AS role_name',
    );
    const identity = identityResult.rows[0];
    if (typeof identity?.database_name !== 'string' || typeof identity.role_name !== 'string') {
      throw new Error();
    }

    const ledgerResult = await client.query(
      "SELECT to_regclass('public.famshield_migrations') IS NOT NULL AS ledger_exists",
    );
    const ledgerExists = ledgerResult.rows[0]?.ledger_exists === true;
    let appliedMigrations: StagingDatabaseStatus['appliedMigrations'] = [];
    if (ledgerExists) {
      const migrationsResult = await client.query(
        'SELECT migration_name, applied_at FROM public.famshield_migrations ORDER BY migration_name',
      );
      appliedMigrations = migrationsResult.rows.map((row) => {
        if (
          typeof row.migration_name !== 'string' ||
          (!(row.applied_at instanceof Date) && typeof row.applied_at !== 'string')
        ) {
          throw new Error();
        }
        return {
          name: row.migration_name,
          appliedAt: row.applied_at instanceof Date ? row.applied_at.toISOString() : row.applied_at,
        };
      });
    }

    const tablesResult = await client.query(
      "SELECT tablename AS table_name FROM pg_catalog.pg_tables WHERE schemaname = 'public' ORDER BY tablename",
    );
    const publicTables = tablesResult.rows.map((row) => {
      if (typeof row.table_name !== 'string') throw new Error();
      return row.table_name;
    });

    await client.query('COMMIT');
    return {
      database: identity.database_name,
      role: identity.role_name,
      migrationLedgerExists: ledgerExists,
      appliedMigrations,
      publicTables,
    };
  } catch {
    try {
      await client.query('ROLLBACK');
    } catch {
      throw new Error('Read-only database status inspection and rollback failed.');
    }
    throw new Error('Read-only database status inspection failed.');
  }
}
