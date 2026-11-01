export function resolveListenPort(portOverride: string | undefined, apiPort: number): number {
  if (portOverride === undefined) return apiPort;

  if (!/^[0-9]+$/.test(portOverride)) {
    throw new Error('PORT must be an integer TCP port between 1 and 65535.');
  }

  const port = Number(portOverride);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer TCP port between 1 and 65535.');
  }

  return port;
}
