import { createServer } from 'node:http';
import { app } from './app.js';
import { connectDatabase, disconnectDatabase, getDatabaseStatus } from './config/database.js';
import { env } from './config/env.js';
import { resolveListenPort } from './config/serverConfig.js';
import { purgeExpiredAuthRecords } from './services/authService.js';
import { cleanupExpiredLocationSharing } from './services/locationService.js';
import { createRealtimeServer } from './sockets/realtimeServer.js';

const server = createServer(app);
const realtimeServer = createRealtimeServer(server);
const listenPort = resolveListenPort(process.env.PORT, env.API_PORT);
let cleanupTimer: NodeJS.Timeout | undefined;
let locationCleanupTimer: NodeJS.Timeout | undefined;

async function shutdown(signal: string): Promise<void> {
  console.info(`${signal} received; shutting down.`);
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
  }
  if (locationCleanupTimer) {
    clearInterval(locationCleanupTimer);
  }
  try {
    await realtimeServer.close();
  } catch (error) {
    console.error('HTTP server shutdown failed:', error);
    process.exitCode = 1;
  }
  try {
    await disconnectDatabase();
  } catch (databaseError) {
    console.error('Database shutdown failed:', databaseError);
    process.exitCode = 1;
  }
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
  const cleanupLocations = async () => {
    try {
      await cleanupExpiredLocationSharing();
    } catch (error) {
      console.error(
        'Expired location-sharing cleanup failed:',
        error instanceof Error ? error.name : 'Unknown error',
      );
    }
  };
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
  await cleanupLocations();
  locationCleanupTimer = setInterval(() => void cleanupLocations(), 60 * 1000);
  locationCleanupTimer.unref();
  await cleanupExpiredRecords();
  cleanupTimer = setInterval(() => void cleanupExpiredRecords(), 60 * 60 * 1000);
  cleanupTimer.unref();
}

server.listen(listenPort, '0.0.0.0', () => {
  console.info(`FamShield API listening on port ${listenPort}.`);
});
