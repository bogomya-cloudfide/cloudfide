import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import type { Todo } from '../types'
import { TodoList } from './TodoList'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))
vi.mock('./TodoEmptyState', () => ({
  TodoEmptyState: ({
    hasTodos,
    disabled,
    onCreate,
  }: {
    hasTodos: boolean
    disabled: boolean
    onCreate: () => void
  }) => (
    <div>
      <p>Empty task list</p>
      <button disabled={disabled} onClick={onCreate}>
        create ({hasTodos ? 'has tasks' : 'no tasks'})
      </button>
    </div>
  ),
}))
vi.mock('./TodoItem', () => ({
  TodoItem: ({
    todo,
    busy,
    onToggle,
    onEdit,
    onDelete,
  }: {
    todo: Todo
    busy: boolean
    onToggle: () => void
    onEdit: () => void
    onDelete: () => void
  }) => (
    <li>
      {todo.title}
      <button disabled={busy} onClick={onToggle}>
        toggle {todo.id}
      </button>
      <button onClick={onEdit}>edit {todo.id}</button>
      <button onClick={onDelete}>delete {todo.id}</button>
    </li>
  ),
}))

it('shows loading feedback before showing an empty list', () => {
  const props = {
    todos: [],
    hasTodos: false,
    failed: false,
    busy: false,
    onCreate: vi.fn(),
    onToggle: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
  }
  const { rerender } = render(<TodoList {...props} loading />)
  expect(screen.getByRole('status')).toHaveTextContent('Loading your tasks…')
  expect(screen.queryByText('Empty task list')).not.toBeInTheDocument()
  rerender(<TodoList {...props} loading={false} />)
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.getByText('Empty task list')).toBeVisible()
})

const baseProps = {
  todos: [] as Todo[],
  hasTodos: false,
  loading: false,
  failed: false,
  busy: false,
  onCreate: vi.fn(),
  onToggle: vi.fn(),
  onEdit: vi.fn(),
  onDelete: vi.fn(),
}

it('shows an unavailable message when loading failed and nothing is cached', () => {
  render(<TodoList {...baseProps} failed />)
  expect(
    screen.getByRole('heading', {
      level: 3,
      name: 'The task list is temporarily unavailable',
    }),
  ).toBeInTheDocument()
  expect(screen.getByText('Try again to load your tasks.')).toBeInTheDocument()
  expect(screen.queryByText('Empty task list')).not.toBeInTheDocument()
})

it('keeps showing tasks when a refetch failed but data exists', () => {
  render(<TodoList {...baseProps} failed hasTodos todos={[todoFixture]} />)
  expect(screen.getByText(todoFixture.title)).toBeInTheDocument()
  expect(
    screen.queryByText('The task list is temporarily unavailable'),
  ).not.toBeInTheDocument()
})

it('renders each task and wires item callbacks to that task', async () => {
  const other = { ...todoFixture, id: 8, title: 'Second' }
  const props = {
    ...baseProps,
    onToggle: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
  }
  render(<TodoList {...props} hasTodos todos={[todoFixture, other]} />)
  expect(screen.getAllByRole('listitem')).toHaveLength(2)
  await userEvent.click(screen.getByRole('button', { name: 'toggle 8' }))
  await userEvent.click(screen.getByRole('button', { name: 'edit 7' }))
  await userEvent.click(screen.getByRole('button', { name: 'delete 8' }))
  expect(props.onToggle).toHaveBeenCalledWith(other)
  expect(props.onEdit).toHaveBeenCalledWith(todoFixture)
  expect(props.onDelete).toHaveBeenCalledWith(other)
})

it('passes busy to items', () => {
  render(<TodoList {...baseProps} busy hasTodos todos={[todoFixture]} />)
  expect(screen.getByRole('button', { name: 'toggle 7' })).toBeDisabled()
})

it('disables the empty-state action while busy', () => {
  render(<TodoList {...baseProps} hasTodos busy />)
  const button = screen.getByRole('button', { name: 'create (has tasks)' })
  expect(button).toBeDisabled()
})

it('lets the empty state create a task', async () => {
  const onCreate = vi.fn()
  render(<TodoList {...baseProps} onCreate={onCreate} />)
  await userEvent.click(
    screen.getByRole('button', { name: 'create (no tasks)' }),
  )
  expect(onCreate).toHaveBeenCalledTimes(1)
})
