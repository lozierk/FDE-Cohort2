/**
 * Boots the gateway's express app on an ephemeral port for one test file. Node's test
 * runner gives each test *file* its own process, so setting process.env here (before the
 * dynamic import, which is what actually evaluates env.ts) is safe per file without
 * leaking into other test files.
 */
import type { AddressInfo } from 'node:net';

export type TestGateway = {
  baseUrl: string;
  close: () => Promise<void>;
};

export async function startGateway(envOverrides: Record<string, string> = {}): Promise<TestGateway> {
  for (const [k, v] of Object.entries(envOverrides)) process.env[k] = v;
  const { app } = await import('../../src/app.js');
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve()))
  };
}
