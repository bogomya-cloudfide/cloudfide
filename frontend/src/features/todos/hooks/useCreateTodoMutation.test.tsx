import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import { useCreateTodoMutation } from './useCreateTodoMutation'

vi.mock('../api/todos', () => ({ todosApi: { create: vi.fn() } }))
beforeEach(() => vi.clearAllMocks())

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, ...renderHook(() => useCreateTodoMutation(), { wrapper }) }
}

const input = {
  title: 'New',
  description: '',
  priority: 'low' as const,
  due_date: null,
  completed: false,
}

it('puts the created task first in the cached list', async () => {
  const saved = { ...todoFixture, id: 9, title: 'New' }
  vi.mocked(todosApi.create).mockResolvedValue(saved)
  const { client, result } = setup()
  client.setQueryData(todoKeys.list, [todoFixture])
  await act(() => result.current.mutateAsync(input))
  expect(todosApi.create).toHaveBeenCalledWith(input)
  expect(client.getQueryData(todoKeys.list)).toEqual([saved, todoFixture])
})

it('creates the list from an empty cache and avoids duplicates by id', async () => {
  vi.mocked(todosApi.create).mockResolvedValue(todoFixture)
  const { client, result } = setup()
  await act(() => result.current.mutateAsync(input))
  expect(client.getQueryData(todoKeys.list)).toEqual([todoFixture])
  await act(() => result.current.mutateAsync(input))
  expect(client.getQueryData(todoKeys.list)).toEqual([todoFixture])
})

it('is not overwritten by a slower list fetch started before the save', async () => {
  const saved = { ...todoFixture, id: 9, title: 'New' }
  vi.mocked(todosApi.create).mockResolvedValue(saved)
  const { client, result } = setup()
  client.setQueryData(todoKeys.list, [todoFixture])
  let resolveStale: (value: (typeof todoFixture)[]) => void = () => undefined
  const stale = client
    .fetchQuery({
      queryKey: todoKeys.list,
      queryFn: () =>
        new Promise<(typeof todoFixture)[]>((resolve) => {
          resolveStale = resolve
        }),
      staleTime: 0,
    })
    .catch(() => undefined)
  await act(() => result.current.mutateAsync(input))
  resolveStale([todoFixture])
  await stale
  expect(client.getQueryData(todoKeys.list)).toEqual([saved, todoFixture])
})

it('leaves the cache unchanged when creation fails', async () => {
  vi.mocked(todosApi.create).mockRejectedValue(new Error('boom'))
  const { client, result } = setup()
  client.setQueryData(todoKeys.list, [todoFixture])
  await act(() => result.current.mutateAsync(input).catch(() => undefined))
  expect(client.getQueryData(todoKeys.list)).toEqual([todoFixture])
})
