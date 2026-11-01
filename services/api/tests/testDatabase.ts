import type { Pool } from 'pg';

let testDatabase: Pool | undefined;

export function setTestDatabase(database: Pool): void {
  testDatabase = database;
}

export function getTestDatabase(): Pool {
  if (!testDatabase) {
    throw new Error('The isolated PostgreSQL test database is not initialized.');
  }
  return testDatabase;
}

export async function waitForLockWaiters(
  queryFragment: string,
  expectedCount: number,
  timeoutMilliseconds = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    const result = await getTestDatabase().query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM pg_stat_activity
       WHERE application_name = 'famshield-api-tests'
         AND state = 'active'
         AND wait_event_type = 'Lock'
         AND query ILIKE $1`,
      [`%${queryFragment}%`],
    );
    if (Number(result.rows[0]?.count ?? 0) >= expectedCount) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const activeQueries = await getTestDatabase().query<{
    application_name: string;
    state: string;
    wait_event_type: string | null;
    query: string;
  }>(
    `SELECT application_name, state, wait_event_type, query
     FROM pg_stat_activity
     WHERE datname = current_database() AND pid <> pg_backend_pid()`,
  );
  throw new Error(
    `Timed out waiting for ${expectedCount} PostgreSQL lock waiters matching ${queryFragment}. Active sessions: ${JSON.stringify(activeQueries.rows)}`,
  );
}

export async function waitForNoLockWaiters(
  queryFragment: string,
  timeoutMilliseconds = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    const result = await getTestDatabase().query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM pg_stat_activity
       WHERE application_name = 'famshield-api-tests'
         AND state = 'active'
         AND wait_event_type = 'Lock'
         AND query ILIKE $1`,
      [`%${queryFragment}%`],
    );
    if (Number(result.rows[0]?.count ?? 0) === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(
    `Timed out waiting for PostgreSQL lock waiters matching ${queryFragment} to clear.`,
  );
}
