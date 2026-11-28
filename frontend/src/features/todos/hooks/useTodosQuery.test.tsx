import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import { useTodosQuery } from './useTodosQuery'

vi.mock('../api/todos', () => ({ todosApi: { list: vi.fn() } }))
beforeEach(() => vi.clearAllMocks())

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, ...renderHook(() => useTodosQuery(), { wrapper }) }
}

it('loads tasks into the list cache and passes an abort signal', async () => {
  vi.mocked(todosApi.list).mockResolvedValue([todoFixture])
  const { client, result } = setup()
  await waitFor(() => expect(result.current.data).toEqual([todoFixture]))
  expect(client.getQueryData(todoKeys.list)).toEqual([todoFixture])
  expect(vi.mocked(todosApi.list).mock.calls[0][0]).toBeInstanceOf(AbortSignal)
})

it('exposes the error when loading fails', async () => {
  vi.mocked(todosApi.list).mockRejectedValue(new Error('down'))
  const { result } = setup()
  await waitFor(() => expect(result.current.error?.message).toBe('down'))
})
