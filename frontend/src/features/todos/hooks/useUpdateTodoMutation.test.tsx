import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import { useUpdateTodoMutation } from './useUpdateTodoMutation'

vi.mock('../api/todos', () => ({ todosApi: { update: vi.fn() } }))
beforeEach(() => vi.clearAllMocks())

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, ...renderHook(() => useUpdateTodoMutation(), { wrapper }) }
}

it('replaces only the updated task in the cached list', async () => {
  const saved = { ...todoFixture, completed: true }
  vi.mocked(todosApi.update).mockResolvedValue(saved)
  const other = { ...todoFixture, id: 8 }
  const { client, result } = setup()
  client.setQueryData(todoKeys.list, [todoFixture, other])
  await act(() =>
    result.current.mutateAsync({
      id: todoFixture.id,
      input: { completed: true },
    }),
  )
  expect(todosApi.update).toHaveBeenCalledWith(todoFixture.id, {
    completed: true,
  })
  expect(client.getQueryData(todoKeys.list)).toEqual([saved, other])
})

it('does not create a list when nothing is cached', async () => {
  vi.mocked(todosApi.update).mockResolvedValue(todoFixture)
  const { client, result } = setup()
  await act(() => result.current.mutateAsync({ id: 7, input: {} }))
  expect(client.getQueryData(todoKeys.list)).toBeUndefined()
})

it('is not overwritten by a slower list fetch started before the save', async () => {
  const saved = { ...todoFixture, completed: true }
  vi.mocked(todosApi.update).mockResolvedValue(saved)
  const { client, result } = setup()
  client.setQueryData(todoKeys.list, [todoFixture])
  let resolveStale!: (todos: (typeof todoFixture)[]) => void
  const stale = client.fetchQuery({
    queryKey: todoKeys.list,
    queryFn: () =>
      new Promise<(typeof todoFixture)[]>((resolve) => {
        resolveStale = resolve
      }),
  })
  await act(() =>
    result.current.mutateAsync({
      id: todoFixture.id,
      input: { completed: true },
    }),
  )
  resolveStale([todoFixture])
  await stale
  expect(client.getQueryData(todoKeys.list)).toEqual([saved])
})

it('invalidates the stats after updating', async () => {
  vi.mocked(todosApi.update).mockResolvedValue(todoFixture)
  const { client, result } = setup()
  client.setQueryData(todoKeys.stats, {
    total: 1,
    active: 1,
    completed: 0,
    overdue: 0,
  })
  await act(() => result.current.mutateAsync({ id: 1, input: {} }))
  expect(client.getQueryState(todoKeys.stats)?.isInvalidated).toBe(true)
})

it('keeps the cached list when the update fails', async () => {
  vi.mocked(todosApi.update).mockRejectedValue(new Error('boom'))
  const { client, result } = setup()
  client.setQueryData(todoKeys.list, [todoFixture])
  await act(() =>
    result.current
      .mutateAsync({ id: 7, input: { title: 'x' } })
      .catch(() => undefined),
  )
  expect(client.getQueryData(todoKeys.list)).toEqual([todoFixture])
})
