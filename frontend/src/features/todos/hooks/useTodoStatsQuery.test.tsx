import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import { useTodoStatsQuery } from './useTodoStatsQuery'

vi.mock('../api/todos', () => ({ todosApi: { stats: vi.fn() } }))
beforeEach(() => vi.clearAllMocks())

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, ...renderHook(() => useTodoStatsQuery(), { wrapper }) }
}

it('loads stats into the stats cache and passes an abort signal', async () => {
  const stats = { total: 3, active: 2, completed: 1, overdue: 1 }
  vi.mocked(todosApi.stats).mockResolvedValue(stats)
  const { client, result } = setup()
  await waitFor(() => expect(result.current.data).toEqual(stats))
  expect(client.getQueryData(todoKeys.stats)).toEqual(stats)
  expect(vi.mocked(todosApi.stats).mock.calls[0][0]).toBeInstanceOf(AbortSignal)
})

it('exposes the error when loading fails', async () => {
  vi.mocked(todosApi.stats).mockRejectedValue(new Error('down'))
  const { result } = setup()
  await waitFor(() => expect(result.current.error?.message).toBe('down'))
})
