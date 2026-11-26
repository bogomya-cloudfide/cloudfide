import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { useCreateTodoMutation } from '../hooks/useCreateTodoMutation'
import { useUpdateTodoMutation } from '../hooks/useUpdateTodoMutation'
import type { TodoInput } from '../types'
import { TodoEditor } from './TodoEditor'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))
vi.mock('../hooks/useCreateTodoMutation', () => ({
  useCreateTodoMutation: vi.fn(),
}))
vi.mock('../hooks/useUpdateTodoMutation', () => ({
  useUpdateTodoMutation: vi.fn(),
}))
vi.mock('./TodoForm', () => ({
  TodoForm: ({
    onSubmit,
    initial,
    busy,
    error,
  }: {
    onSubmit: (input: TodoInput) => Promise<void>
    initial?: { title: string }
    busy: boolean
    error: string | null
  }) => (
    <div>
      <p>initial: {initial?.title ?? 'none'}</p>
      <p>busy: {String(busy)}</p>
      <p>error: {error ?? 'none'}</p>
      <button onClick={() => void onSubmit(todoFixture)}>Submit form</button>
    </div>
  ),
}))

function mockMutations(
  create: Record<string, unknown>,
  update: Record<string, unknown>,
) {
  vi.mocked(useCreateTodoMutation).mockReturnValue({
    isPending: false,
    error: null,
    mutateAsync: vi.fn(),
    ...create,
  } as unknown as ReturnType<typeof useCreateTodoMutation>)
  vi.mocked(useUpdateTodoMutation).mockReturnValue({
    isPending: false,
    error: null,
    mutateAsync: vi.fn(),
    ...update,
  } as unknown as ReturnType<typeof useUpdateTodoMutation>)
}

it('creates a new task and reports a successful save', async () => {
  const user = userEvent.setup()
  const create = vi.fn().mockResolvedValue(todoFixture)
  const update = vi.fn()
  vi.mocked(useCreateTodoMutation).mockReturnValue({
    isPending: false,
    error: null,
    mutateAsync: create,
  } as unknown as ReturnType<typeof useCreateTodoMutation>)
  vi.mocked(useUpdateTodoMutation).mockReturnValue({
    isPending: false,
    error: null,
    mutateAsync: update,
  } as unknown as ReturnType<typeof useUpdateTodoMutation>)
  const onSaved = vi.fn()
  render(
    <TodoEditor todo="new" busy={false} onClose={vi.fn()} onSaved={onSaved} />,
  )
  expect(screen.getByRole('dialog', { name: 'New task' })).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Submit form' }))
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith('New task added.'))
  expect(create).toHaveBeenCalledWith(todoFixture)
  expect(update).not.toHaveBeenCalled()
})

it('opens an empty form for a new task', () => {
  mockMutations({}, {})
  render(
    <TodoEditor todo="new" busy={false} onClose={vi.fn()} onSaved={vi.fn()} />,
  )
  expect(screen.getByText('initial: none')).toBeInTheDocument()
})

it('updates an existing task and reports saved changes', async () => {
  const user = userEvent.setup()
  const update = vi.fn().mockResolvedValue(todoFixture)
  const create = vi.fn()
  mockMutations({ mutateAsync: create }, { mutateAsync: update })
  const onSaved = vi.fn()
  render(
    <TodoEditor
      todo={todoFixture}
      busy={false}
      onClose={vi.fn()}
      onSaved={onSaved}
    />,
  )
  expect(screen.getByRole('dialog', { name: 'Edit task' })).toBeVisible()
  expect(screen.getByText(`initial: ${todoFixture.title}`)).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Submit form' }))
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith('Changes saved.'))
  expect(update).toHaveBeenCalledWith({
    id: todoFixture.id,
    input: todoFixture,
  })
  expect(create).not.toHaveBeenCalled()
})

it('does not report success and shows the error when saving fails', async () => {
  const user = userEvent.setup()
  const create = vi.fn().mockRejectedValue(new Error('Server said no'))
  mockMutations({ mutateAsync: create, error: new Error('Server said no') }, {})
  const onSaved = vi.fn()
  render(
    <TodoEditor todo="new" busy={false} onClose={vi.fn()} onSaved={onSaved} />,
  )
  expect(screen.getByText('error: Server said no')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Submit form' }))
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
  expect(onSaved).not.toHaveBeenCalled()
})

it('shows only the active mutation error', () => {
  mockMutations({ error: new Error('create error') }, { error: null })
  render(
    <TodoEditor
      todo={todoFixture}
      busy={false}
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />,
  )
  expect(screen.getByText('error: none')).toBeInTheDocument()
})

it('ignores submits while saving and marks the form busy', async () => {
  const user = userEvent.setup()
  const create = vi.fn()
  mockMutations({ mutateAsync: create, isPending: true }, {})
  render(
    <TodoEditor todo="new" busy={false} onClose={vi.fn()} onSaved={vi.fn()} />,
  )
  expect(screen.getByText('busy: true')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Submit form' }))
  expect(create).not.toHaveBeenCalled()
})

it('treats the external busy flag as pending', async () => {
  const user = userEvent.setup()
  const create = vi.fn()
  mockMutations({ mutateAsync: create }, {})
  render(<TodoEditor todo="new" busy onClose={vi.fn()} onSaved={vi.fn()} />)
  expect(screen.getByText('busy: true')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Submit form' }))
  expect(create).not.toHaveBeenCalled()
})

it('closes through the drawer close button', async () => {
  const user = userEvent.setup()
  mockMutations({}, {})
  const onClose = vi.fn()
  render(
    <TodoEditor todo="new" busy={false} onClose={onClose} onSaved={vi.fn()} />,
  )
  await user.click(screen.getByRole('button', { name: 'Close' }))
  expect(onClose).toHaveBeenCalledTimes(1)
})
