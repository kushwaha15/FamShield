import { Pool, type PoolClient } from 'pg';
import { createStagingDatabaseTarget, readStagingDatabaseStatus } from './stagingDatabaseStatus.js';

async function main(): Promise<void> {
  let pool: Pool | undefined;
  let client: PoolClient | undefined;
  let failed = false;

  try {
    const target = createStagingDatabaseTarget(process.env.DATABASE_URL);
    pool = new Pool({
      connectionString: target.connectionString,
      ssl: { ca: target.ca, rejectUnauthorized: true },
      max: 1,
      connectionTimeoutMillis: 10_000,
    });
    client = await pool.connect();
    const status = await readStagingDatabaseStatus(client);
    console.log(JSON.stringify(status, null, 2));
  } catch (error) {
    failed = true;
    const message =
      error instanceof Error && error.message.startsWith('DATABASE_URL')
        ? error.message
        : error instanceof Error && error.message.startsWith('The configured staging CA')
          ? error.message
          : 'Staging database status check failed.';
    console.error(message);
  } finally {
    if (client) {
      try {
        client.release();
      } catch {
        failed = true;
        console.error('Failed to release the staging database connection.');
      }
    }
    if (pool) {
      try {
        await pool.end();
      } catch {
        failed = true;
        console.error('Failed to close the staging database connection pool.');
      }
    }
  }

  if (failed) process.exitCode = 1;
}

await main();
