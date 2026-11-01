import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PoolClient } from 'pg';
import { STAGING_PROJECT_REFERENCE } from './stagingDatabaseStatus.js';

export const STAGING_MIGRATION_APPROVAL = 'MIGRATE FamShield-Staging';

export interface StagingTargetMetadata {
  projectReference: string;
  database: string;
  role: string;
  connectionType: 'Supabase Session Pooler';
  tlsVerified: true;
}

export async function inspectTargetAndApplyStagingMigrations(
  client: PoolClient,
  requestApproval: () => Promise<string>,
  displayMetadata: (metadata: StagingTargetMetadata) => void,
  migrationsDirectory = getMigrationsDirectory(),
): Promise<string[]> {
  const identity = await client.query(
    'SELECT current_database() AS database_name, current_user AS role_name',
  );
  const database = identity.rows[0]?.database_name;
  const role = identity.rows[0]?.role_name;
  if (typeof database !== 'string' || typeof role !== 'string') {
    throw new Error('Unable to verify staging database metadata.');
  }

  displayMetadata({
    projectReference: STAGING_PROJECT_REFERENCE,
    database,
    role,
    connectionType: 'Supabase Session Pooler',
    tlsVerified: true,
  });

  if ((await requestApproval()) !== STAGING_MIGRATION_APPROVAL) {
    return [];
  }

  return applyStagingMigrations(client, migrationsDirectory);
}

export async function applyStagingMigrations(
  client: PoolClient,
  migrationsDirectory = getMigrationsDirectory(),
): Promise<string[]> {
  let lockAcquired = false;
  const appliedMigrations: string[] = [];

  try {
    await client.query('SELECT pg_advisory_lock($1, $2)', [74123, 1]);
    lockAcquired = true;
    await client.query(`
      CREATE TABLE IF NOT EXISTS famshield_migrations (
        migration_name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const migrations = (await readdir(migrationsDirectory))
      .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
      .sort();

    for (const migrationName of migrations) {
      const existing = await client.query(
        'SELECT 1 FROM famshield_migrations WHERE migration_name = $1',
        [migrationName],
      );
      if (existing.rowCount) continue;

      const migration = await readFile(join(migrationsDirectory, migrationName), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(migration);
        await client.query('INSERT INTO famshield_migrations (migration_name) VALUES ($1)', [
          migrationName,
        ]);
        await client.query('COMMIT');
        appliedMigrations.push(migrationName);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    return appliedMigrations;
  } finally {
    if (lockAcquired) {
      await client.query('SELECT pg_advisory_unlock($1, $2)', [74123, 1]);
    }
  }
}

function getMigrationsDirectory(): string {
  const sourceMigrationsDirectory = fileURLToPath(new URL('../../drizzle/', import.meta.url));
  return existsSync(sourceMigrationsDirectory)
    ? sourceMigrationsDirectory
    : fileURLToPath(new URL('../../../drizzle/', import.meta.url));
}
