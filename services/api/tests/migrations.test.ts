import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getDatabase, runMigrations } from '../src/config/database.js';
import { getTestDatabase } from './testDatabase.js';

describe('database migrations', () => {
  it('applies ordered migrations once and safely skips them on repeat runs', async () => {
    const before = await getDatabase().execute(
      sql`SELECT migration_name FROM famshield_migrations ORDER BY migration_name`,
    );
    expect(before.rows.map((row) => row.migration_name)).toEqual([
      '0001_authentication.sql',
      '0002_family_management.sql',
      '0003_location_sharing_consent.sql',
      '0004_location_sharing.sql',
    ]);

    await runMigrations();
    await runMigrations();
    const after = await getDatabase().execute(
      sql`SELECT migration_name FROM famshield_migrations ORDER BY migration_name`,
    );
    expect(after.rows).toEqual(before.rows);
  });

  it('keeps family and consent tables behind backend-only row-level security', async () => {
    const tables = await getDatabase().execute(
      sql`SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('families', 'family_members', 'family_invitations', 'consents', 'location_sharing_sessions', 'location_positions') AND relkind = 'r'`,
    );
    expect(tables.rows).toHaveLength(6);
    expect(tables.rows.every((table) => table.relrowsecurity === true)).toBe(true);

    const roleClient = await getTestDatabase().connect();
    try {
      await roleClient.query(
        'GRANT SELECT ON families, family_members, family_invitations, consents, location_sharing_sessions, location_positions TO anon',
      );
      await roleClient.query('SET ROLE anon');
      const visibleFamilies = await roleClient.query('SELECT id FROM families');
      expect(visibleFamilies.rows).toHaveLength(0);
      const visibleConsents = await roleClient.query('SELECT id FROM consents');
      expect(visibleConsents.rows).toHaveLength(0);
      const visibleSessions = await roleClient.query('SELECT id FROM location_sharing_sessions');
      expect(visibleSessions.rows).toHaveLength(0);
      const visiblePositions = await roleClient.query('SELECT user_id FROM location_positions');
      expect(visiblePositions.rows).toHaveLength(0);
    } finally {
      await roleClient.query('RESET ROLE');
      roleClient.release();
    }
  });
});
