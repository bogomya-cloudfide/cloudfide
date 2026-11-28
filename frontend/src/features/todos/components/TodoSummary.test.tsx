import { render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { Badge } from '../../../design-system'
import { TodoSummary } from './TodoSummary'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))
beforeEach(() => vi.clearAllMocks())

it('renders nothing without stats', () => {
  render(<TodoSummary />)
  expect(screen.queryByLabelText('Task summary')).not.toBeInTheDocument()
})

it('shows every count and highlights overdue tasks', () => {
  render(
    <TodoSummary stats={{ total: 5, active: 3, completed: 2, overdue: 1 }} />,
  )
  const summary = screen.getByLabelText('Task summary')
  expect(summary).toHaveTextContent('Total: 5')
  expect(summary).toHaveTextContent('To do: 3')
  expect(summary).toHaveTextContent('Completed: 2')
  expect(summary).toHaveTextContent('Overdue: 1')
  const overdue = vi
    .mocked(Badge)
    .mock.calls.find(([props]) => String(props.children).includes('Overdue'))
  expect(overdue?.[0].variant).toBe('warning')
})

it('hides the overdue badge when nothing is overdue', () => {
  render(
    <TodoSummary stats={{ total: 1, active: 1, completed: 0, overdue: 0 }} />,
  )
  const summary = screen.getByLabelText('Task summary')
  expect(summary).toHaveTextContent('Total: 1')
  expect(summary).not.toHaveTextContent('Overdue')
  const overdue = vi
    .mocked(Badge)
    .mock.calls.find(([props]) => String(props.children).includes('Overdue'))
  expect(overdue).toBeUndefined()
})
