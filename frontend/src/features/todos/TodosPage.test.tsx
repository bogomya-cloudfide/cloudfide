import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { useNotice } from '../../hooks/useNotice'
import { todoFixture } from '../../test/todoFixture'
import type { Todo } from './types'
import { useTodoFilters } from './hooks/useTodoFilters'
import { useTodosBusy } from './hooks/useTodosBusy'
import { useTodosQuery } from './hooks/useTodosQuery'
import { useUpdateTodoMutation } from './hooks/useUpdateTodoMutation'
import { TodosPage } from './TodosPage'

vi.mock('../../design-system', () => import('../../design-system/mocks'))
vi.mock('../../hooks/useNotice', () => ({ useNotice: vi.fn() }))
vi.mock('./hooks/useTodoFilters', () => ({ useTodoFilters: vi.fn() }))
vi.mock('./hooks/useTodosBusy', () => ({ useTodosBusy: vi.fn() }))
vi.mock('./hooks/useTodosQuery', () => ({ useTodosQuery: vi.fn() }))
vi.mock('./hooks/useUpdateTodoMutation', () => ({
  useUpdateTodoMutation: vi.fn(),
}))
vi.mock('./components/TodosHeader', () => ({
  TodosHeader: ({
    disabled,
    onCreate,
  }: {
    disabled: boolean
    onCreate: () => void
  }) => (
    <>
      <h1>Tasks</h1>
      <button disabled={disabled} onClick={onCreate}>
        New task
      </button>
    </>
  ),
}))
vi.mock('./components/TodoFilters', () => ({ TodoFilters: () => null }))
vi.mock('./components/TodoList', () => ({
  TodoList: ({
    todos,
    hasTodos,
    loading,
    failed,
    busy,
    onToggle,
    onEdit,
    onDelete,
    onCreate,
  }: {
    todos: Todo[]
    hasTodos: boolean
    loading: boolean
    failed: boolean
    busy: boolean
    onCreate: () => void
    onToggle: (todo: Todo) => void
    onEdit: (todo: Todo) => void
    onDelete: (todo: Todo) => void
  }) => (
    <div>
      <p>Task list</p>
      <p data-testid="list-state">
        {`hasTodos=${hasTodos} loading=${loading} failed=${failed} busy=${busy}`}
      </p>
      <button onClick={onCreate}>Create from list</button>
      <button onClick={() => onToggle(todos[0])}>Toggle first</button>
      <button onClick={() => onEdit(todos[0])}>Edit first</button>
      <button onClick={() => onDelete(todos[0])}>Delete first</button>
    </div>
  ),
}))
vi.mock('./components/TodoEditor', () => ({
  TodoEditor: ({
    todo,
    onClose,
    onSaved,
  }: {
    todo: Todo | 'new'
    onClose: () => void
    onSaved: (notice: string) => void
  }) => (
    <div role="dialog" aria-label="Editor">
      <p>{todo === 'new' ? 'editing new' : `editing ${todo.title}`}</p>
      <button onClick={onClose}>Close editor</button>
      <button onClick={() => onSaved('Task created.')}>Save editor</button>
    </div>
  ),
}))
vi.mock('./components/DeleteTodoDialog', () => ({
  DeleteTodoDialog: ({
    todo,
    onClose,
    onDeleted,
  }: {
    todo: Todo
    onClose: () => void
    onDeleted: () => void
  }) => (
    <div role="dialog" aria-label="Delete">
      <p>deleting {todo.title}</p>
      <button onClick={onClose}>Close delete</button>
      <button onClick={onDeleted}>Confirm delete</button>
    </div>
  ),
}))
vi.mock('../../components/SuccessNotice', () => ({
  SuccessNotice: ({ message }: { message: string }) => (
    <p data-testid="notice">{message}</p>
  ),
}))

it('displays a query failure and resets mutation errors before retrying', async () => {
  const user = userEvent.setup()
  const refetch = vi.fn().mockResolvedValue(undefined)
  const reset = vi.fn()
  vi.mocked(useTodosQuery).mockReturnValue({
    data: [],
    isPending: false,
    isFetching: false,
    isError: true,
    error: new Error('The server is unavailable.'),
    refetch,
  } as unknown as ReturnType<typeof useTodosQuery>)
  vi.mocked(useUpdateTodoMutation).mockReturnValue({
    error: null,
    reset,
    mutateAsync: vi.fn(),
  } as unknown as ReturnType<typeof useUpdateTodoMutation>)
  vi.mocked(useTodosBusy).mockReturnValue(false)
  vi.mocked(useNotice).mockReturnValue({ message: '', notify: vi.fn() })
  vi.mocked(useTodoFilters).mockReturnValue({
    filter: 'all',
    search: '',
    sort: 'newest',
    visible: [],
    setFilter: vi.fn(),
    setSearch: vi.fn(),
    setSort: vi.fn(),
  })
  render(<TodosPage />)
  expect(screen.getByTestId('alert')).toHaveTextContent(
    'The server is unavailable.',
  )
  await user.click(screen.getByRole('button', { name: 'Try again' }))
  await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1))
  expect(reset).toHaveBeenCalledTimes(1)
  expect(reset.mock.invocationCallOrder[0]).toBeLessThan(
    refetch.mock.invocationCallOrder[0],
  )
})

function setup({
  busy = false,
  mutateAsync = vi.fn(),
  mutationError = null as Error | null,
  message = '',
  visible = [todoFixture],
  query = {},
}: {
  busy?: boolean
  mutateAsync?: ReturnType<typeof vi.fn>
  mutationError?: Error | null
  message?: string
  visible?: Todo[]
  query?: Partial<ReturnType<typeof useTodosQuery>>
} = {}) {
  const notify = vi.fn()
  vi.mocked(useTodosQuery).mockReturnValue({
    data: [todoFixture],
    isPending: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...query,
  } as unknown as ReturnType<typeof useTodosQuery>)
  vi.mocked(useUpdateTodoMutation).mockReturnValue({
    error: mutationError,
    reset: vi.fn(),
    mutateAsync,
  } as unknown as ReturnType<typeof useUpdateTodoMutation>)
  vi.mocked(useTodosBusy).mockReturnValue(busy)
  vi.mocked(useNotice).mockReturnValue({ message, notify })
  vi.mocked(useTodoFilters).mockReturnValue({
    filter: 'all',
    search: '',
    sort: 'newest',
    visible,
    setFilter: vi.fn(),
    setSearch: vi.fn(),
    setSort: vi.fn(),
  })
  render(<TodosPage />)
  return { notify, mutateAsync }
}

beforeEach(() => vi.clearAllMocks())

it('toggles a task and congratulates when it becomes completed', async () => {
  const user = userEvent.setup()
  const mutateAsync = vi
    .fn()
    .mockResolvedValue({ ...todoFixture, completed: true })
  const { notify } = setup({ mutateAsync })
  await user.click(screen.getByRole('button', { name: 'Toggle first' }))
  expect(mutateAsync).toHaveBeenCalledWith({
    id: todoFixture.id,
    input: { completed: true },
  })
  expect(notify).toHaveBeenCalledWith('Another task complete. Well done!')
})

it('announces when a task is marked active again', async () => {
  const user = userEvent.setup()
  const done = { ...todoFixture, completed: true }
  const mutateAsync = vi.fn().mockResolvedValue({ ...done, completed: false })
  const { notify } = setup({ mutateAsync, visible: [done] })
  await user.click(screen.getByRole('button', { name: 'Toggle first' }))
  expect(mutateAsync).toHaveBeenCalledWith({
    id: done.id,
    input: { completed: false },
  })
  expect(notify).toHaveBeenCalledWith('Task marked as active.')
})

it('ignores toggles while busy', async () => {
  const user = userEvent.setup()
  const { mutateAsync, notify } = setup({ busy: true })
  await user.click(screen.getByRole('button', { name: 'Toggle first' }))
  expect(mutateAsync).not.toHaveBeenCalled()
  expect(notify).not.toHaveBeenCalled()
})

it('stays quiet when toggling fails', async () => {
  const user = userEvent.setup()
  const mutateAsync = vi.fn().mockRejectedValue(new Error('nope'))
  const { notify } = setup({ mutateAsync })
  await user.click(screen.getByRole('button', { name: 'Toggle first' }))
  expect(mutateAsync).toHaveBeenCalledTimes(1)
  expect(notify).not.toHaveBeenCalled()
})

it('shows the toggle error in preference to the query error', () => {
  setup({
    mutationError: new Error('Could not update the task.'),
    query: { isError: true, error: new Error('Could not load tasks.') },
  })
  expect(screen.getByTestId('alert')).toHaveTextContent(
    'Could not update the task.',
  )
  expect(screen.getByTestId('alert')).not.toHaveTextContent(
    'Could not load tasks.',
  )
})

it('blocks creation and shows the list as loading during the first load', () => {
  setup({
    visible: [],
    query: { data: undefined, isPending: true, isFetching: true },
  })
  expect(screen.getByRole('button', { name: 'New task' })).toBeDisabled()
  expect(screen.getByTestId('list-state')).toHaveTextContent(
    'hasTodos=false loading=true failed=false busy=false',
  )
})

it('disables retrying while a failed first load is being refetched', () => {
  setup({
    visible: [],
    query: {
      data: undefined,
      isError: true,
      isFetching: true,
      error: new Error('The server is unavailable.'),
    },
  })
  expect(screen.getByRole('button', { name: 'Try again' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'New task' })).toBeEnabled()
  expect(screen.getByTestId('list-state')).toHaveTextContent(
    'hasTodos=false loading=false failed=true busy=false',
  )
})

it('tells the list that tasks exist when filters hide all of them', () => {
  setup({ visible: [] })
  expect(screen.getByTestId('list-state')).toHaveTextContent('hasTodos=true')
})

it('opens and closes the editor for a new task and notifies on save', async () => {
  const user = userEvent.setup()
  const { notify } = setup()
  expect(
    screen.queryByRole('dialog', { name: 'Editor' }),
  ).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'New task' }))
  expect(screen.getByText('editing new')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Close editor' }))
  expect(
    screen.queryByRole('dialog', { name: 'Editor' }),
  ).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'New task' }))
  await user.click(screen.getByRole('button', { name: 'Save editor' }))
  expect(notify).toHaveBeenCalledWith('Task created.')
  expect(
    screen.queryByRole('dialog', { name: 'Editor' }),
  ).not.toBeInTheDocument()
})

it('opens the new-task editor from the list empty state', async () => {
  const user = userEvent.setup()
  setup()
  await user.click(screen.getByRole('button', { name: 'Create from list' }))
  expect(screen.getByText('editing new')).toBeInTheDocument()
})

it('edits an existing task', async () => {
  const user = userEvent.setup()
  setup()
  await user.click(screen.getByRole('button', { name: 'Edit first' }))
  expect(screen.getByText(`editing ${todoFixture.title}`)).toBeInTheDocument()
})

it('confirms deletion, closes the dialog and notifies', async () => {
  const user = userEvent.setup()
  const { notify } = setup()
  await user.click(screen.getByRole('button', { name: 'Delete first' }))
  expect(screen.getByText(`deleting ${todoFixture.title}`)).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Close delete' }))
  expect(
    screen.queryByRole('dialog', { name: 'Delete' }),
  ).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Delete first' }))
  await user.click(screen.getByRole('button', { name: 'Confirm delete' }))
  expect(notify).toHaveBeenCalledWith('Task deleted.')
  expect(
    screen.queryByRole('dialog', { name: 'Delete' }),
  ).not.toBeInTheDocument()
})

it('disables creation while busy and shows the current notice', () => {
  setup({ busy: true, message: 'Saved' })
  expect(screen.getByRole('button', { name: 'New task' })).toBeDisabled()
  expect(screen.getByTestId('list-state')).toHaveTextContent('busy=true')
  expect(screen.getByTestId('notice')).toHaveTextContent('Saved')
})
