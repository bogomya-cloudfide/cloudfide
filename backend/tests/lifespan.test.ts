import { afterEach, it, expect, vi } from 'vitest';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { start } from '../src/core/lifespan.ts';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it('disconnects and rethrows when the database cannot connect', async () => {
  vi.stubEnv('DATABASE_URL', 'postgresql://test:test@localhost:5432/test');
  const connect = vi.spyOn(PrismaClient.prototype, '$connect').mockRejectedValue(new Error('connection refused'));
  const disconnect = vi.spyOn(PrismaClient.prototype, '$disconnect').mockResolvedValue(undefined);
  await expect(start()).rejects.toThrow('connection refused');
  expect(connect).toHaveBeenCalledOnce();
  expect(disconnect).toHaveBeenCalledOnce();
});
