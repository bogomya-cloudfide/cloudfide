---
name: writing-backend-tests
description: Conventions, seams, pitfalls and a worked example for unit tests of this repository's backend (Express 5, Prisma 7, Zod 4, Vitest, Supertest). Use before creating or editing any file under backend/tests.
---

# Writing backend tests

## Layout and style
- Tests live flat in `backend/tests/` as `<basename>.test.ts` (`src/core/config.ts` → `tests/config.test.ts`). Prefix the parent folder only when two sources share a basename. Only `tests/**/*.test.ts` is collected; helpers go in `tests/` without `.test`.
- Import Vitest APIs explicitly (`import { afterEach, it, expect, vi } from 'vitest'`); globals are off.
- Import sources with the `.ts` extension: `'../src/features/todos/router.ts'` (sources themselves use `.js`).
- Shared fixtures are in `tests/fixture.ts`: `record` is a Prisma row (Date fields), `todo` is the same task as API JSON (string dates). Vary them by spreading (`{ ...record, completed: true }`); add new shared fixtures there.
- Match the existing files: semicolons, single quotes, hooks and `setup()` helpers above the tests, top-level `it` (a `describe` only for large tables), `it.each` for input variants, compact lines.

## Seams: no database, no network
- Prisma: build the real client with `createDatabase('postgresql://test:test@localhost:5432/test')`; it connects lazily, so nothing is opened. Stub the delegate method: `vi.spyOn(database.todo, 'findMany').mockResolvedValue([record])`, and `afterEach(() => vi.restoreAllMocks())`. Do not hand-roll a fake client or `vi.mock` the generated client (`src/generated/prisma/client.ts`).
- Router alone: mount `createTodosRouter(repository)` on `express()` with `express.json()`, where `repository` has a `vi.fn()` for each `TodoStore` method (see `tests/router.test.ts`). Assert status, body, and what the repository received or that it was not called.
- Whole app: `createApp(database)` with the spied client above, for the health route, `/openapi.json`, the 404 fallback and the error handler.

## Pitfalls
- `src/core/config.ts` loads the repository-root `.env` when imported. It exists on developer machines and not in CI, so tests of code that reads `process.env` must `vi.stubEnv` every variable that code reads (`undefined` = absent) and `vi.unstubAllEnvs()` in `afterEach`. Otherwise they pass locally and fail in CI, or the reverse.
- A router mounted without `createApp` has no JSON error handler; test 500 responses through `createApp`. Its handler logs with `console.error`: silence it with a spy and assert the call.
- Validation failures are 422 with `detail` set to the Zod issue array. Assert the status and that the repository was not called, not the issue objects.

## Example
```ts
import { afterEach, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createDatabase } from '../src/core/database.ts';
import { createApp } from '../src/factory.ts';

afterEach(() => vi.restoreAllMocks());

function setup() {
  const database = createDatabase('postgresql://test:test@localhost:5432/test');
  return { database, app: createApp(database) };
}

it('answers 500 without leaking a database failure', async () => {
  const { database, app } = setup();
  vi.spyOn(database.todo, 'findMany').mockRejectedValue(new Error('connection refused'));
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  const response = await request(app).get('/api/todos');
  expect(response.status).toBe(500);
  expect(response.body).toEqual({ detail: 'Internal Server Error' });
  expect(consoleError).toHaveBeenCalledWith(expect.objectContaining({ message: 'connection refused' }));
});
```
