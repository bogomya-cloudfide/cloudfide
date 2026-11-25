---
name: writing-frontend-tests
description: Conventions, design-system mocking, pitfalls and a worked example for unit tests of this repository's frontend (React 19, TanStack Query 5, Vitest, React Testing Library, jsdom). Use before creating or editing any frontend test, test fixture or design-system/mocks.tsx.
---

# Writing frontend tests

## Layout and style
- One test file per module, next to it: `X.tsx` → `X.test.tsx`, `x.ts` → `x.test.ts`, or `x.test.tsx` when the test contains JSX (e.g. a provider wrapper). Do not bundle several modules into one test file.
- Prettier style (no semicolons, single quotes, trailing commas); format with the command in `verifying-tests`.
- Import Vitest APIs explicitly (`import { expect, it, vi } from 'vitest'`). `tsconfig.json` loads `vitest/globals` types, so a missing import passes typecheck and then fails at runtime with `it is not defined`.
- `src/test/setup.ts` already registers jest-dom matchers and RTL `cleanup`. Shared fixtures go in `src/test/` (`todoFixture` exists).
- Interactions: `const user = userEvent.setup()` in the test, then `await user.click(...)`; not the static `userEvent.click`.
- Before writing, open the nearest existing test of the same kind (a sibling hook or component test; `lib/http.test.ts` for code that calls `fetch`) and follow its setup.

## Mocks
- Components import from the `design-system` barrel. Tests swap it for the Vitest doubles with an async factory, since `vi.mock` is hoisted: `vi.mock('../../../design-system', () => import('../../../design-system/mocks'))` (path relative to the test). Never render the real styled components.
- Read `mocks.tsx` first: doubles decide what is queryable (`Alert` has no role → `getByTestId('alert')`; `Drawer` is a `dialog` named by `title`).
- Every double is a `vi.fn`, so design-only props (`variant`, `level`, `muted`) can be read from `vi.mocked(Badge).mock.calls`; add `beforeEach(() => vi.clearAllMocks())` when you do. Assert the DOM for everything else.
- If a component uses a design-system export that `mocks.tsx` lacks, add a double there in the same style instead of rendering the real one.
- A page or container test may mock its child components and hooks (see `TodosPage.test.tsx`); return partial hook results cast `as unknown as ReturnType<typeof useX>`. A mocked child must surface the props its parent computes (render the values, expose callbacks as buttons), and a mocked hook's arguments are asserted (`expect(useTodoFilters).toHaveBeenCalledWith(todos)`); otherwise that wiring goes untested.

## Pitfalls
- `isOverdue` (and so TodoItem's due-date badge) compares with today's local date, so pin the clock. Do not add `vi.useFakeTimers()` for it: userEvent and `waitFor` then hang.
- Timer-driven state (see `useNotice.test.ts`): `vi.useFakeTimers()` and `act(() => vi.advanceTimersByTime(ms))`. With fake timers, userEvent needs `userEvent.setup({ advanceTimers: vi.advanceTimersByTime })`.
- TanStack Query hooks: give each test a fresh `QueryClient` with `retry: false` for queries and mutations in a `QueryClientProvider` wrapper; never run them against the `lib/queryClient` singleton (state leaks between tests, retries on). Mock the API module (`todosApi`), seed with `client.setQueryData(todoKeys.list, ...)` and assert the resulting cache or hook state; do not mock `useQuery` or `useMutation`. To observe `cancelQueries`, let a list fetch that started earlier resolve after the mutation and assert the cache keeps the saved value.

## Example
```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import { useDeleteTodoMutation } from './useDeleteTodoMutation'

vi.mock('../api/todos', () => ({ todosApi: { remove: vi.fn() } }))
beforeEach(() => vi.clearAllMocks())

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, ...renderHook(() => useDeleteTodoMutation(), { wrapper }) }
}

it('removes the deleted task from the cached list', async () => {
  vi.mocked(todosApi.remove).mockResolvedValue(undefined)
  const other = { ...todoFixture, id: 8 }
  const { client, result } = setup()
  client.setQueryData(todoKeys.list, [todoFixture, other])
  await act(() => result.current.mutateAsync(todoFixture.id))
  expect(todosApi.remove).toHaveBeenCalledWith(todoFixture.id)
  expect(client.getQueryData(todoKeys.list)).toEqual([other])
})
```
