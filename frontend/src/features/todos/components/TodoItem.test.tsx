import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Text } from '../../../design-system'
import { todoFixture } from '../../../test/todoFixture'
import type { Todo } from '../types'
import { TodoItem } from './TodoItem'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))

it('shows an active task and forwards edit requests', async () => {
  const user = userEvent.setup()
  const onEdit = vi.fn()
  const onToggle = vi.fn()
  const onDelete = vi.fn()
  render(
    <TodoItem
      todo={todoFixture}
      busy={false}
      onEdit={onEdit}
      onToggle={onToggle}
      onDelete={onDelete}
    />,
  )
  expect(screen.getByRole('heading', { name: todoFixture.title })).toBeVisible()
  expect(screen.getByText('To do')).toBeVisible()
  expect(screen.getByText('Medium')).toBeVisible()
  expect(screen.getByRole('checkbox')).not.toBeChecked()
  await user.click(
    screen.getByRole('button', { name: `Edit: ${todoFixture.title}` }),
  )
  expect(onEdit).toHaveBeenCalledTimes(1)
  expect(onToggle).not.toHaveBeenCalled()
  expect(onDelete).not.toHaveBeenCalled()
})

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.useRealTimers())

function renderItem(
  todo: Todo,
  busy = false,
  handlers = { onToggle: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn() },
) {
  render(<TodoItem todo={todo} busy={busy} {...handlers} />)
  return handlers
}

it('shows a completed task with its description and unchecks on toggle', async () => {
  const todo: Todo = {
    ...todoFixture,
    completed: true,
    description: 'Line one',
    priority: 'high',
  }
  const { onToggle } = renderItem(todo)
  expect(screen.getByText('Completed')).toBeVisible()
  expect(screen.queryByText('To do')).not.toBeInTheDocument()
  expect(screen.getByText('Line one')).toBeVisible()
  expect(screen.getByText('High')).toBeVisible()
  expect(screen.getByText(`#${todo.id}`)).toBeVisible()
  const checkbox = screen.getByRole('checkbox', {
    name: `Mark as active: ${todo.title}`,
  })
  expect(checkbox).toBeChecked()
  await userEvent.click(checkbox)
  expect(onToggle).toHaveBeenCalledTimes(1)
})

it('labels the checkbox for completing an active task and omits empty description', () => {
  renderItem(todoFixture)
  expect(
    screen.getByRole('checkbox', { name: `Complete: ${todoFixture.title}` }),
  ).not.toBeChecked()
  expect(vi.mocked(Text).mock.calls.some(([p]) => p.preserveWhitespace)).toBe(
    false,
  )
})

it('forwards delete requests', async () => {
  const { onDelete } = renderItem(todoFixture)
  await userEvent.click(
    screen.getByRole('button', { name: `Delete: ${todoFixture.title}` }),
  )
  expect(onDelete).toHaveBeenCalledTimes(1)
})

it('disables every action while busy', () => {
  renderItem(todoFixture, true)
  expect(screen.getByRole('checkbox')).toBeDisabled()
  expect(
    screen.getByRole('button', { name: `Edit: ${todoFixture.title}` }),
  ).toBeDisabled()
  expect(
    screen.getByRole('button', { name: `Delete: ${todoFixture.title}` }),
  ).toBeDisabled()
})

it('flags an open task with a past due date as overdue', () => {
  vi.setSystemTime(new Date(2026, 9, 15, 12))
  renderItem({ ...todoFixture, due_date: '2026-10-14' })
  expect(screen.getByText(/14 Oct 2026 · overdue/)).toBeVisible()
})

it('shows a future or completed due date without the overdue flag', () => {
  vi.setSystemTime(new Date(2026, 9, 15, 12))
  renderItem({ ...todoFixture, due_date: '2026-10-20' })
  expect(screen.getByText('20 Oct 2026')).toBeVisible()
  expect(screen.queryByText(/overdue/)).not.toBeInTheDocument()
})

it('does not flag a completed task as overdue', () => {
  vi.setSystemTime(new Date(2026, 9, 15, 12))
  renderItem({ ...todoFixture, due_date: '2026-10-01', completed: true })
  expect(screen.getByText('1 Oct 2026')).toBeVisible()
  expect(screen.queryByText(/overdue/)).not.toBeInTheDocument()
})
