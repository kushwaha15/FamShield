import { describe, expect, it } from 'vitest';
import { assertNoConnectionStringSslOverrides } from '../src/config/databaseTls.js';
import { resolveListenPort } from '../src/config/serverConfig.js';

describe('API listen port selection', () => {
  it('uses the Render PORT override when supplied', () => {
    expect(resolveListenPort('10000', 3000)).toBe(10000);
  });

  it('falls back to API_PORT when PORT is absent', () => {
    expect(resolveListenPort(undefined, 3000)).toBe(3000);
  });

  it.each(['', '0', '-1', '65536', '3000.5', 'not-a-port', ' 3000'])(
    'rejects invalid PORT value %j',
    (port) => {
      expect(() => resolveListenPort(port, 3000)).toThrow(
        'PORT must be an integer TCP port between 1 and 65535.',
      );
    },
  );
});

describe('production database TLS URL options', () => {
  it('allows connection strings without SSL query parameters', () => {
    expect(() =>
      assertNoConnectionStringSslOverrides(
        'postgresql://db.example.test:5432/famshield?application_name=famshield-api',
      ),
    ).not.toThrow();
  });

  it.each(['sslmode=disable', 'sslmode=require', 'sslrootcert=%2Ftmp%2Fca.crt', 'SSLcert=x'])(
    'rejects SSL connection-string override %s',
    (parameter) => {
      expect(() =>
        assertNoConnectionStringSslOverrides(
          `postgresql://db.example.test:5432/famshield?${parameter}`,
        ),
      ).toThrow('DATABASE_URL must not contain SSL parameters');
    },
  );
});
