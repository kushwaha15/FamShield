import { describe, expect, it, vi } from 'vitest';
import {
  readStagingDatabaseStatus,
  STAGING_PROJECT_REFERENCE,
  validateStagingDatabaseUrl,
} from '../src/config/stagingDatabaseStatus.js';

const validUrl = `postgresql://postgres.${STAGING_PROJECT_REFERENCE}:secret@aws-0-us-east-1.pooler.supabase.com:5432/postgres`;

describe('staging database status target validation', () => {
  it('requires an explicitly supplied URL', () => {
    expect(() => validateStagingDatabaseUrl(undefined)).toThrow(
      'DATABASE_URL must be explicitly supplied',
    );
  });

  it.each([
    'mysql://postgres.apytozlgrnycswqgnanb:secret@aws-0-us-east-1.pooler.supabase.com:5432/postgres',
    'postgresql://postgres.apytozlgrnycswqgnanb:@aws-0-us-east-1.pooler.supabase.com:5432/postgres',
    'postgresql://postgres.otherproject:secret@aws-0-us-east-1.pooler.supabase.com:5432/postgres',
    'postgresql://postgres.apytozlgrnycswqgnanb:secret@db.apytozlgrnycswqgnanb.supabase.co:5432/postgres',
    'postgresql://postgres.apytozlgrnycswqgnanb:secret@nested.aws-0.pooler.supabase.com:5432/postgres',
    'postgresql://postgres.apytozlgrnycswqgnanb:secret@aws-0-us-east-1.pooler.supabase.com:6543/postgres',
    `${validUrl}?sslmode=disable`,
    `${validUrl}?sslrootcert=C%3A%5Csecret.crt`,
  ])('rejects unsafe database URL: %s', (url) => {
    expect(() => validateStagingDatabaseUrl(url)).toThrow();
  });

  it('accepts the expected session pooler and strips supported sslmode=require', () => {
    const validatedUrl = validateStagingDatabaseUrl(
      `${validUrl}?sslmode=require&application_name=status-check`,
    );
    const parsed = new URL(validatedUrl);

    expect(parsed.hostname).toBe('aws-0-us-east-1.pooler.supabase.com');
    expect(parsed.username).toBe(`postgres.${STAGING_PROJECT_REFERENCE}`);
    expect(parsed.searchParams.has('sslmode')).toBe(false);
    expect(parsed.searchParams.get('application_name')).toBe('status-check');
  });

  it('validates the decoded pooler username', () => {
    const encodedUsername = validUrl.replace(
      `postgres.${STAGING_PROJECT_REFERENCE}`,
      `postgres%2E${STAGING_PROJECT_REFERENCE}`,
    );
    expect(() => validateStagingDatabaseUrl(encodedUsername)).not.toThrow();
  });
});

describe('read-only staging database status', () => {
  it('reads identity, migration ledger and public tables in a read-only transaction', async () => {
    const statements: string[] = [];
    const query = vi.fn(async (statement: string) => {
      statements.push(statement);
      if (statement.startsWith('SELECT current_database()')) {
        return { rows: [{ database_name: 'postgres', role_name: 'postgres' }] };
      }
      if (statement.includes('to_regclass')) {
        return { rows: [{ ledger_exists: true }] };
      }
      if (statement.includes('FROM public.famshield_migrations')) {
        return {
          rows: [
            {
              migration_name: '0001_authentication.sql',
              applied_at: new Date('2026-01-01T00:00:00.000Z'),
            },
          ],
        };
      }
      if (statement.includes('pg_catalog.pg_tables')) {
        return { rows: [{ table_name: 'users' }] };
      }
      return { rows: [] };
    });

    const status = await readStagingDatabaseStatus({ query });

    expect(status).toEqual({
      database: 'postgres',
      role: 'postgres',
      migrationLedgerExists: true,
      appliedMigrations: [
        { name: '0001_authentication.sql', appliedAt: '2026-01-01T00:00:00.000Z' },
      ],
      publicTables: ['users'],
    });
    expect(statements[0]).toBe('BEGIN TRANSACTION READ ONLY');
    expect(statements.at(-1)).toBe('COMMIT');
    expect(
      statements.some((statement) =>
        /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(statement),
      ),
    ).toBe(false);
  });

  it('skips ledger reads when the migration ledger does not exist', async () => {
    const statements: string[] = [];
    const query = vi.fn(async (statement: string) => {
      statements.push(statement);
      if (statement.startsWith('SELECT current_database()')) {
        return { rows: [{ database_name: 'postgres', role_name: 'readonly' }] };
      }
      if (statement.includes('to_regclass')) return { rows: [{ ledger_exists: false }] };
      if (statement.includes('pg_catalog.pg_tables')) return { rows: [] };
      return { rows: [] };
    });

    const status = await readStagingDatabaseStatus({ query });

    expect(status.migrationLedgerExists).toBe(false);
    expect(status.appliedMigrations).toEqual([]);
    expect(
      statements.some((statement) => statement.includes('FROM public.famshield_migrations')),
    ).toBe(false);
    expect(statements.at(-1)).toBe('COMMIT');
  });

  it('rolls back the read-only transaction after an inspection failure', async () => {
    const statements: string[] = [];
    const query = vi.fn(async (statement: string) => {
      statements.push(statement);
      if (statement.startsWith('SELECT current_database()')) {
        return { rows: [{ database_name: 'postgres', role_name: 'readonly' }] };
      }
      if (statement.includes('to_regclass')) throw new Error('sensitive raw database error');
      return { rows: [] };
    });

    await expect(readStagingDatabaseStatus({ query })).rejects.toThrow(
      'Read-only database status inspection failed.',
    );
    expect(statements.at(-1)).toBe('ROLLBACK');
  });
});
