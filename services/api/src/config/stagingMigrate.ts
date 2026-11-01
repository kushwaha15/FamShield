import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { Pool, type PoolClient } from 'pg';
import { createStagingDatabaseTarget } from './stagingDatabaseStatus.js';
import {
  inspectTargetAndApplyStagingMigrations,
  type StagingTargetMetadata,
} from './stagingMigrations.js';

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

    const readline = createInterface({ input: stdin, output: stdout });
    try {
      const applied = await inspectTargetAndApplyStagingMigrations(
        client,
        () => readline.question(`Type exactly "MIGRATE FamShield-Staging" to continue: `),
        (metadata: StagingTargetMetadata) => {
          console.log('Verified staging target:');
          console.log(JSON.stringify(metadata, null, 2));
        },
      );
      if (applied.length === 0) {
        console.log('No migrations were applied.');
      } else {
        console.log(`Applied migrations: ${applied.join(', ')}`);
      }
    } finally {
      readline.close();
    }
  } catch {
    failed = true;
    console.error('Staging migration command failed; review the target and configuration.');
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
