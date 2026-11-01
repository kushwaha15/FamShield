export function assertNoConnectionStringSslOverrides(connectionString: string): void {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL.');
  }

  if ([...url.searchParams.keys()].some((parameter) => parameter.toLowerCase().startsWith('ssl'))) {
    throw new Error('DATABASE_URL must not contain SSL parameters; TLS is configured by the API.');
  }
}
