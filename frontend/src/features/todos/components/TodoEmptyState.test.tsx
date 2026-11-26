import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { TodoEmptyState } from './TodoEmptyState'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))

it('invites creating the first task and calls onCreate', async () => {
  const onCreate = vi.fn()
  render(
    <TodoEmptyState hasTodos={false} disabled={false} onCreate={onCreate} />,
  )
  expect(
    screen.getByRole('heading', { level: 3, name: 'Add your first task' }),
  ).toBeInTheDocument()
  expect(
    screen.getByText('Write down what you need to do and get started.'),
  ).toBeInTheDocument()
  await userEvent.click(
    screen.getByRole('button', { name: 'Add your first task' }),
  )
  expect(onCreate).toHaveBeenCalledTimes(1)
})

it('disables the create button when disabled', () => {
  render(<TodoEmptyState hasTodos={false} disabled onCreate={vi.fn()} />)
  expect(
    screen.getByRole('button', { name: 'Add your first task' }),
  ).toBeDisabled()
})

it('explains that nothing matches and offers no create button when tasks exist', () => {
  render(<TodoEmptyState hasTodos disabled={false} onCreate={vi.fn()} />)
  expect(
    screen.getByRole('heading', { level: 3, name: 'No matching tasks' }),
  ).toBeInTheDocument()
  expect(
    screen.getByText('Change the status filter or search to find your tasks.'),
  ).toBeInTheDocument()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})
