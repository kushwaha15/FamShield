import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PoolClient } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyStagingMigrations,
  inspectTargetAndApplyStagingMigrations,
  STAGING_MIGRATION_APPROVAL,
} from '../src/config/stagingMigrations.js';
import { STAGING_PROJECT_REFERENCE } from '../src/config/stagingDatabaseStatus.js';

const temporaryDirectories: string[] = [];

async function createMigrations(files: Record<string, string>): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'famshield-staging-migrations-'));
  temporaryDirectories.push(directory);
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(directory, name), content);
  }
  return directory;
}

function mockClient(
  handler: (
    statement: string,
    values?: unknown[],
  ) => Promise<{ rowCount: number | null; rows: [] }>,
): PoolClient {
  return { query: vi.fn(handler) } as unknown as PoolClient;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('staging migration approval gate', () => {
  it('displays verified target metadata and does not apply migrations without exact approval', async () => {
    const statements: string[] = [];
    const client = mockClient(async (statement) => {
      statements.push(statement);
      if (statement.includes('current_database()')) {
        return {
          rowCount: 1,
          rows: [{ database_name: 'postgres', role_name: 'postgres' }] as never,
        };
      }
      return { rowCount: 0, rows: [] };
    });
    const display = vi.fn();
    const requestApproval = vi.fn(async () => 'MIGRATE FamShield-Staging ');
    const migrationsDirectory = await createMigrations({
      '0001_authentication.sql': 'SELECT 1;',
    });

    const applied = await inspectTargetAndApplyStagingMigrations(
      client,
      requestApproval,
      display,
      migrationsDirectory,
    );

    expect(applied).toEqual([]);
    expect(display).toHaveBeenCalledWith({
      projectReference: STAGING_PROJECT_REFERENCE,
      database: 'postgres',
      role: 'postgres',
      connectionType: 'Supabase Session Pooler',
      tlsVerified: true,
    });
    expect(statements).toEqual([
      'SELECT current_database() AS database_name, current_user AS role_name',
    ]);
  });

  it('applies only after exact approval', async () => {
    const statements: string[] = [];
    let ledger = new Set<string>();
    const client = mockClient(async (statement, values) => {
      statements.push(statement);
      if (statement.includes('current_database()')) {
        return {
          rowCount: 1,
          rows: [{ database_name: 'postgres', role_name: 'postgres' }] as never,
        };
      }
      if (statement.startsWith('SELECT 1 FROM famshield_migrations')) {
        return { rowCount: ledger.has(String(values?.[0])) ? 1 : 0, rows: [] };
      }
      if (statement.startsWith('INSERT INTO famshield_migrations')) {
        ledger.add(String(values?.[0]));
      }
      return { rowCount: 0, rows: [] };
    });
    const migrationsDirectory = await createMigrations({
      '0001_authentication.sql': 'SELECT 1;',
    });

    const applied = await inspectTargetAndApplyStagingMigrations(
      client,
      async () => STAGING_MIGRATION_APPROVAL,
      () => undefined,
      migrationsDirectory,
    );

    expect(applied).toEqual(['0001_authentication.sql']);
    expect(statements).toContain('SELECT pg_advisory_lock($1, $2)');
    expect(
      statements.some((statement) =>
        statement.includes('CREATE TABLE IF NOT EXISTS famshield_migrations'),
      ),
    ).toBe(true);
    expect(statements).toContain('SELECT pg_advisory_unlock($1, $2)');
    expect(statements.indexOf('BEGIN')).toBeLessThan(statements.indexOf('SELECT 1;'));
    expect(statements.indexOf('SELECT 1;')).toBeLessThan(
      statements.findIndex((statement) => statement === 'COMMIT'),
    );
  });
});

describe('staging migration execution', () => {
  it('applies migration files lexically and skips ledger entries already applied', async () => {
    const statements: string[] = [];
    const ledger = new Set(['0002_second.sql']);
    const client = mockClient(async (statement, values) => {
      statements.push(statement);
      if (statement.startsWith('SELECT 1 FROM famshield_migrations')) {
        return { rowCount: ledger.has(String(values?.[0])) ? 1 : 0, rows: [] };
      }
      if (statement.startsWith('INSERT INTO famshield_migrations')) {
        ledger.add(String(values?.[0]));
      }
      return { rowCount: 0, rows: [] };
    });
    const migrationsDirectory = await createMigrations({
      '0003_third.sql': 'SELECT 3;',
      '0002_second.sql': 'SELECT 2;',
      '0001_first.sql': 'SELECT 1;',
      'ignored.sql': 'SELECT 0;',
    });

    const applied = await applyStagingMigrations(client, migrationsDirectory);

    expect(applied).toEqual(['0001_first.sql', '0003_third.sql']);
    expect(statements.indexOf('SELECT 1;')).toBeLessThan(statements.indexOf('SELECT 3;'));
    expect(statements).not.toContain('SELECT 2;');
    expect(ledger).toEqual(new Set(['0001_first.sql', '0002_second.sql', '0003_third.sql']));
    expect(statements.filter((statement) => statement === 'BEGIN')).toHaveLength(2);
    expect(statements.filter((statement) => statement === 'COMMIT')).toHaveLength(2);
  });

  it('rolls back a failed migration and releases the advisory lock', async () => {
    const statements: string[] = [];
    const client = mockClient(async (statement) => {
      statements.push(statement);
      if (statement === 'SELECT 1;') throw new Error('database details must not be surfaced');
      return { rowCount: 0, rows: [] };
    });
    const migrationsDirectory = await createMigrations({
      '0001_failure.sql': 'SELECT 1;',
      '0002_not_reached.sql': 'SELECT 2;',
    });

    await expect(applyStagingMigrations(client, migrationsDirectory)).rejects.toThrow(
      'database details must not be surfaced',
    );
    expect(statements).toContain('ROLLBACK');
    expect(statements).toContain('SELECT pg_advisory_unlock($1, $2)');
    expect(statements).not.toContain('SELECT 2;');
  });
});
