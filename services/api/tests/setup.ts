import { createServer } from 'node:net';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { afterAll } from 'vitest';
import { setTestDatabase } from './testDatabase.js';

process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = 'test-only-access-secret-that-is-long-enough-123456';
process.env.AUTH_TOKEN_PEPPER = 'test-only-token-pepper-that-is-long-enough-123456';
process.env.AUTH_DEV_OTP_EXPOSE = 'true';
process.env.BCRYPT_ROUNDS = '10';
process.env.OTP_TTL_MINUTES = '5';
process.env.SMS_PROVIDER = 'development';
process.env.EMAIL_PROVIDER = 'development';

const reservation = createServer();
await new Promise<void>((resolve, reject) => {
  reservation.once('error', reject);
  reservation.listen(0, '127.0.0.1', resolve);
});
const address = reservation.address();
if (!address || typeof address === 'string') {
  throw new Error('Unable to allocate a PostgreSQL test port.');
}
const port = address.port;
await new Promise<void>((resolve, reject) => {
  reservation.close((error) => (error ? reject(error) : resolve()));
});

const postgres = await PGlite.create();
await postgres.exec(`
  CREATE ROLE anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  CREATE ROLE service_role NOLOGIN;
`);
setTestDatabase(postgres);
const socketServer = new PGLiteSocketServer({ db: postgres, host: '127.0.0.1', port });
await socketServer.start();
process.env.DATABASE_URL = `postgresql://postgres@127.0.0.1:${port}/postgres`;

const { connectDatabase, runMigrations } = await import('../src/config/database.js');
await connectDatabase();
await runMigrations();

afterAll(async () => {
  const { disconnectDatabase } = await import('../src/config/database.js');
  await disconnectDatabase();
  await socketServer.stop();
  await postgres.close();
});
