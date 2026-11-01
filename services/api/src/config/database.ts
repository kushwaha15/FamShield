import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { ApiError } from '../utils/ApiError.js';
import { env } from './env.js';
import { assertNoConnectionStringSslOverrides } from './databaseTls.js';
import { schema } from '../db/schema.js';

type Database = NodePgDatabase<typeof schema>;

let pool: Pool | undefined;
let database: Database | undefined;
let connected = false;

export async function connectDatabase(): Promise<void> {
  if (!env.DATABASE_URL) {
    console.info('PostgreSQL is not configured; starting in limited readiness mode.');
    return;
  }

  if (env.NODE_ENV === 'production') {
    assertNoConnectionStringSslOverrides(env.DATABASE_URL);
  }

  pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: env.DB_POOL_MAX,
    ...(env.NODE_ENV === 'production' ? { ssl: { rejectUnauthorized: true } } : {}),
  });
  database = drizzle(pool, { schema });
  pool.on('error', (error) => {
    connected = false;
    console.error('PostgreSQL pool error:', error.name);
  });

  await pool.query('SELECT 1');
  connected = true;
  console.info('PostgreSQL connection established.');
}

export function getDatabase(): Database {
  if (!database || !connected) {
    throw new ApiError(503, 'DATABASE_UNAVAILABLE', 'The service database is unavailable.');
  }
  return database;
}

export function getDatabaseStatus(): 'connected' | 'disconnected' {
  return connected ? 'connected' : 'disconnected';
}

export async function runMigrations(): Promise<void> {
  if (!pool) {
    throw new Error('DATABASE_URL must be configured before running migrations.');
  }

  const client = await pool.connect();
  let lockAcquired = false;
  try {
    await client.query('SELECT pg_advisory_lock($1, $2)', [74123, 1]);
    lockAcquired = true;
    await client.query(`
      CREATE TABLE IF NOT EXISTS famshield_migrations (
        migration_name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const sourceMigrationsDirectory = fileURLToPath(new URL('../../drizzle/', import.meta.url));
    const migrationsDirectory = existsSync(sourceMigrationsDirectory)
      ? sourceMigrationsDirectory
      : fileURLToPath(new URL('../../../drizzle/', import.meta.url));
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
        console.info(`Applied PostgreSQL migration ${migrationName}.`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    try {
      if (lockAcquired) {
        await client.query('SELECT pg_advisory_unlock($1, $2)', [74123, 1]);
      }
    } finally {
      client.release();
    }
  }
}

export async function disconnectDatabase(): Promise<void> {
  connected = false;
  if (pool) {
    await pool.end();
    pool = undefined;
    database = undefined;
  }
}
