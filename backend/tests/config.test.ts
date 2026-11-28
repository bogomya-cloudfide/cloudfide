import { afterEach, it, expect, vi } from 'vitest';
import { resolveDatabaseUrl } from '../src/core/config.ts';

afterEach(() => vi.unstubAllEnvs());

const parts = { POSTGRES_USER: 'user', POSTGRES_PASSWORD: 'p@ss', POSTGRES_HOST: 'db', DB_PORT: '5433', POSTGRES_DB: 'my/db' };

function stub(values: Record<string, string | undefined>) {
  for (const name of ['DATABASE_URL', ...Object.keys(parts)]) vi.stubEnv(name, values[name]);
}

it('prefers the override over DATABASE_URL', () => {
  stub({ DATABASE_URL: 'postgresql://env/db' });
  expect(resolveDatabaseUrl('postgresql://override/db')).toBe('postgresql://override/db');
});

it('uses DATABASE_URL and normalizes the psycopg scheme', () => {
  stub({ DATABASE_URL: 'postgresql+psycopg://u:p@host:5432/db' });
  expect(resolveDatabaseUrl()).toBe('postgresql://u:p@host:5432/db');
});

it('builds the URL from the individual variables with encoding', () => {
  stub(parts);
  expect(resolveDatabaseUrl()).toBe('postgresql://user:p%40ss@db:5433/my%2Fdb');
});

it.each(Object.keys(parts))('throws when %s is missing', (name) => {
  stub({ ...parts, [name]: undefined });
  expect(() => resolveDatabaseUrl()).toThrow(`Missing environment variable: ${name}`);
});
