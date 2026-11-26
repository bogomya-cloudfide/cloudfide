import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { todosApi } from '../api/todos'
import { useDeleteTodoMutation } from './useDeleteTodoMutation'
import { useTodosBusy } from './useTodosBusy'
import { useUpdateTodoMutation } from './useUpdateTodoMutation'

vi.mock('../api/todos', () => ({
  todosApi: { remove: vi.fn(), update: vi.fn() },
}))
beforeEach(() => vi.clearAllMocks())

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return renderHook(
    () => ({
      busy: useTodosBusy(),
      remove: useDeleteTodoMutation(),
      update: useUpdateTodoMutation(),
    }),
    { wrapper },
  )
}

it('is idle without mutations', () => {
  const { result } = setup()
  expect(result.current.busy).toBe(false)
})

it('is busy while a mutation is pending and idle after it settles', async () => {
  let resolve!: () => void
  vi.mocked(todosApi.remove).mockReturnValue(
    new Promise<void>((r) => {
      resolve = r
    }),
  )
  const { result } = setup()
  act(() => {
    result.current.remove.mutate(todoFixture.id)
  })
  await waitFor(() => expect(result.current.busy).toBe(true))
  await act(async () => resolve())
  await waitFor(() => expect(result.current.busy).toBe(false))
})

it('is busy while an update is pending', async () => {
  let resolve!: (todo: typeof todoFixture) => void
  vi.mocked(todosApi.update).mockReturnValue(
    new Promise((r) => {
      resolve = r
    }),
  )
  const { result } = setup()
  act(() => {
    result.current.update.mutate({ id: todoFixture.id, input: {} })
  })
  await waitFor(() => expect(result.current.busy).toBe(true))
  await act(async () => resolve(todoFixture))
  await waitFor(() => expect(result.current.busy).toBe(false))
})
