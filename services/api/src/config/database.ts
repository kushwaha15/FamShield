import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { ApiError } from '../utils/ApiError.js';
import { env } from './env.js';
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
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS famshield_migrations (
        migration_name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const migrationName = '0001_authentication.sql';
    const existing = await client.query(
      'SELECT 1 FROM famshield_migrations WHERE migration_name = $1',
      [migrationName],
    );
    if (existing.rowCount) {
      return;
    }

    const migration = await readFile(
      fileURLToPath(new URL('../../drizzle/0001_authentication.sql', import.meta.url)),
      'utf8',
    );
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
  } finally {
    client.release();
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
