import { Pool } from 'pg';
import { afterAll } from 'vitest';
import { setTestDatabase } from './testDatabase.js';
import { startIsolatedPostgres } from './postgresTestServer.js';

process.env.NODE_ENV = 'test';
process.env.DB_POOL_MAX = '10';
process.env.JWT_ACCESS_SECRET = 'test-only-access-secret-that-is-long-enough-123456';
process.env.AUTH_TOKEN_PEPPER = 'test-only-token-pepper-that-is-long-enough-123456';
process.env.AUTH_DEV_OTP_EXPOSE = 'true';
process.env.BCRYPT_ROUNDS = '10';
process.env.OTP_TTL_MINUTES = '5';
process.env.SMS_PROVIDER = 'development';
process.env.EMAIL_PROVIDER = 'development';

const isolatedPostgres = await startIsolatedPostgres();
process.env.DATABASE_URL = isolatedPostgres.connectionString;
const testDatabase = new Pool({
  connectionString: isolatedPostgres.connectionString.replace(
    'application_name=famshield-api-tests',
    'application_name=famshield-test-control',
  ),
  max: 4,
});
setTestDatabase(testDatabase);

await testDatabase.query(`
  CREATE ROLE anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  CREATE ROLE service_role NOLOGIN;
`);

const { connectDatabase, runMigrations } = await import('../src/config/database.js');
await connectDatabase();
await runMigrations();

afterAll(async () => {
  const { disconnectDatabase } = await import('../src/config/database.js');
  await disconnectDatabase();
  await testDatabase.end();
  await isolatedPostgres.stop();
});
