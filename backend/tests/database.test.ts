import { afterEach, it, expect, vi } from 'vitest';
import { createDatabase, initialize } from '../src/core/database.ts';

afterEach(() => vi.restoreAllMocks());

it('creates the todos table idempotently', async () => {
  const database = createDatabase('postgresql://test:test@localhost:5432/test');
  const execute = vi.spyOn(database, '$executeRaw').mockResolvedValue(0 as never);
  await initialize(database);
  expect(execute).toHaveBeenCalledOnce();
  const strings = execute.mock.calls[0][0] as unknown as readonly string[];
  expect(strings.join('')).toContain('CREATE TABLE IF NOT EXISTS todos');
});
