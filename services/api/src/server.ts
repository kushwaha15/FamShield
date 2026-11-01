import { createServer } from 'node:http';
import { app } from './app.js';
import { connectDatabase, disconnectDatabase, getDatabaseStatus } from './config/database.js';
import { env } from './config/env.js';
import { purgeExpiredAuthRecords } from './services/authService.js';

const server = createServer(app);
let cleanupTimer: NodeJS.Timeout | undefined;

async function shutdown(signal: string): Promise<void> {
  console.info(`${signal} received; shutting down.`);
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
  }
  server.close(async (error) => {
    if (error) {
      console.error('HTTP server shutdown failed:', error);
      process.exitCode = 1;
    }

    try {
      await disconnectDatabase();
    } catch (databaseError) {
      console.error('Database shutdown failed:', databaseError);
      process.exitCode = 1;
    }
  });
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await connectDatabase();
} catch (error) {
  console.error(
    'PostgreSQL connection failed; API is starting with degraded readiness:',
    error instanceof Error ? error.name : 'Unknown error',
  );
}

if (getDatabaseStatus() === 'connected') {
  const cleanupExpiredRecords = async () => {
    try {
      await purgeExpiredAuthRecords();
    } catch (error) {
      console.error(
        'Expired authentication record cleanup failed:',
        error instanceof Error ? error.name : 'Unknown error',
      );
    }
  };
  await cleanupExpiredRecords();
  cleanupTimer = setInterval(() => void cleanupExpiredRecords(), 60 * 60 * 1000);
  cleanupTimer.unref();
}

server.listen(env.API_PORT, () => {
  console.info(`FamShield API listening on port ${env.API_PORT}.`);
});
