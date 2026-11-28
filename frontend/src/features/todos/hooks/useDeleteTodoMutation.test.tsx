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

it('does not create a list when nothing is cached', async () => {
  vi.mocked(todosApi.remove).mockResolvedValue(undefined)
  const { client, result } = setup()
  await act(() => result.current.mutateAsync(1))
  expect(client.getQueryData(todoKeys.list)).toBeUndefined()
})

it('is not overwritten by a slower list fetch started before the delete', async () => {
  vi.mocked(todosApi.remove).mockResolvedValue(undefined)
  const other = { ...todoFixture, id: 8 }
  const { client, result } = setup()
  client.setQueryData(todoKeys.list, [todoFixture, other])
  let resolveStale!: (todos: (typeof todoFixture)[]) => void
  const stale = client.fetchQuery({
    queryKey: todoKeys.list,
    queryFn: () =>
      new Promise<(typeof todoFixture)[]>((resolve) => {
        resolveStale = resolve
      }),
  })
  await act(() => result.current.mutateAsync(todoFixture.id))
  resolveStale([todoFixture, other])
  await stale
  expect(client.getQueryData(todoKeys.list)).toEqual([other])
})

it('keeps the cached list when deletion fails', async () => {
  vi.mocked(todosApi.remove).mockRejectedValue(new Error('boom'))
  const { client, result } = setup()
  client.setQueryData(todoKeys.list, [todoFixture])
  await act(() =>
    result.current.mutateAsync(todoFixture.id).catch(() => undefined),
  )
  expect(client.getQueryData(todoKeys.list)).toEqual([todoFixture])
})
