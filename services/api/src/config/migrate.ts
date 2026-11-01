import { connectDatabase, disconnectDatabase, runMigrations } from './database.js';

try {
  await connectDatabase();
  await runMigrations();
} finally {
  await disconnectDatabase();
}
