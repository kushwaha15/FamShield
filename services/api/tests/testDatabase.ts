import type { PGlite } from '@electric-sql/pglite';

let testDatabase: PGlite | undefined;

export function setTestDatabase(database: PGlite): void {
  testDatabase = database;
}

export function getTestDatabase(): PGlite {
  if (!testDatabase) {
    throw new Error('The PostgreSQL test database is not initialized.');
  }
  return testDatabase;
}
