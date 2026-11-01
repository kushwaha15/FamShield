import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, readdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { tmpdir } from 'node:os';

function findPostgresBin(): string {
  const versionedWindowsBins =
    process.platform === 'win32' && process.env.ProgramFiles
      ? (() => {
          const installationRoot = join(process.env.ProgramFiles!, 'PostgreSQL');
          if (!existsSync(installationRoot)) return [];
          return readdirSync(installationRoot, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => join(installationRoot, entry.name, 'bin'))
            .reverse();
        })()
      : [];
  const candidates = [
    process.env.PG_BIN,
    ...(process.env.PATH ?? '').split(delimiter),
    ...versionedWindowsBins,
  ].filter((path): path is string => Boolean(path));
  const executableSuffix = process.platform === 'win32' ? '.exe' : '';
  const bin = candidates.find(
    (candidate) =>
      existsSync(join(candidate, `postgres${executableSuffix}`)) &&
      existsSync(join(candidate, `initdb${executableSuffix}`)) &&
      existsSync(join(candidate, `pg_ctl${executableSuffix}`)),
  );
  if (!bin) {
    throw new Error(
      'PostgreSQL server binaries were not found. Install PostgreSQL or set PG_BIN to its bin directory.',
    );
  }
  return bin;
}

async function allocatePort(): Promise<number> {
  const reservation = createServer();
  await new Promise<void>((resolve, reject) => {
    reservation.once('error', reject);
    reservation.listen(0, '127.0.0.1', resolve);
  });
  const address = reservation.address();
  if (!address || typeof address === 'string') {
    throw new Error('Unable to allocate an isolated PostgreSQL test port.');
  }
  await new Promise<void>((resolve, reject) => {
    reservation.close((error) => (error ? reject(error) : resolve()));
  });
  return address.port;
}

export async function startIsolatedPostgres(): Promise<{
  connectionString: string;
  stop: () => Promise<void>;
}> {
  const bin = findPostgresBin();
  const dataDirectory = await mkdtemp(join(tmpdir(), 'famshield-postgres-test-'));
  const executableSuffix = process.platform === 'win32' ? '.exe' : '';
  const initdb = join(bin, `initdb${executableSuffix}`);
  const pgCtl = join(bin, `pg_ctl${executableSuffix}`);
  const port = await allocatePort();
  const logFile = join(dataDirectory, 'postgres.log');
  let started = false;

  try {
    execFileSync(
      initdb,
      [
        '-D',
        join(dataDirectory, 'data'),
        '-U',
        'postgres',
        '--auth=trust',
        '--no-locale',
        '-E',
        'UTF8',
      ],
      { stdio: 'pipe' },
    );
    execFileSync(
      pgCtl,
      [
        '-D',
        join(dataDirectory, 'data'),
        '-l',
        logFile,
        '-o',
        `-h 127.0.0.1 -p ${port} -c max_connections=50 -c application_name=famshield-postgres-test`,
        '-w',
        'start',
      ],
      { stdio: 'ignore' },
    );
    started = true;
    return {
      connectionString: `postgresql://postgres@127.0.0.1:${port}/postgres?application_name=famshield-api-tests`,
      stop: async () => {
        execFileSync(pgCtl, ['-D', join(dataDirectory, 'data'), '-m', 'fast', '-w', 'stop'], {
          stdio: 'ignore',
        });
        await rm(dataDirectory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (started) {
      try {
        execFileSync(pgCtl, ['-D', join(dataDirectory, 'data'), '-m', 'immediate', '-w', 'stop'], {
          stdio: 'ignore',
        });
      } catch {
        // Preserve the startup error; cleanup below targets only this unique test directory.
      }
    }
    await rm(dataDirectory, { recursive: true, force: true });
    throw error;
  }
}
