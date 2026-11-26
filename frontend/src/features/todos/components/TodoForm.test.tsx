import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TodoForm } from './TodoForm'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))

describe('TodoForm', () => {
  it('rejects a whitespace-only title without submitting', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    render(
      <TodoForm
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        busy={false}
        error={null}
      />,
    )
    await user.type(screen.getByLabelText(/Task title/), '   ')
    await user.click(screen.getByRole('button', { name: 'Save task' }))
    expect(screen.getByText('Enter a task title.')).toBeVisible()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits trimmed values and the selected priority', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(
      <TodoForm
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        busy={false}
        error={null}
      />,
    )
    await user.type(screen.getByLabelText(/Task title/), '  Prepare a demo  ')
    await user.selectOptions(screen.getByLabelText('Priority'), 'high')
    await user.click(screen.getByRole('button', { name: 'Save task' }))
    expect(onSubmit).toHaveBeenCalledWith({
      title: 'Prepare a demo',
      description: '',
      priority: 'high',
      due_date: null,
      completed: false,
    })
  })

  const renderForm = (props: Partial<Parameters<typeof TodoForm>[0]> = {}) => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const onCancel = vi.fn()
    render(
      <TodoForm
        onSubmit={onSubmit}
        onCancel={onCancel}
        busy={false}
        error={null}
        {...props}
      />,
    )
    return { onSubmit, onCancel }
  }

  it('prefills from initial values and submits description and due date', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm({
      initial: {
        title: 'Old',
        description: 'Old text',
        priority: 'low',
        due_date: '2026-10-20',
        completed: true,
      },
    })
    expect(screen.getByLabelText(/Task title/)).toHaveValue('Old')
    expect(screen.getByLabelText(/Due date/)).toHaveValue('2026-10-20')
    await user.type(screen.getByLabelText(/Description/), ' more  ')
    await user.click(screen.getByRole('button', { name: 'Save task' }))
    expect(onSubmit).toHaveBeenCalledWith({
      title: 'Old',
      description: 'Old text more',
      priority: 'low',
      due_date: '2026-10-20',
      completed: true,
    })
  })

  it('sets and clears the due date', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()
    const due = screen.getByLabelText(/Due date/)
    await user.type(due, '2026-11-02')
    await user.clear(due)
    await user.type(screen.getByLabelText(/Task title/), 'A')
    await user.click(screen.getByRole('button', { name: 'Save task' }))
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'A', due_date: null }),
    )
  })

  it('shows description and title length errors without submitting', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm({
      initial: {
        title: 'a'.repeat(121),
        description: 'b'.repeat(2001),
        priority: 'medium',
        due_date: null,
        completed: false,
      },
    })
    await user.click(screen.getByRole('button', { name: 'Save task' }))
    expect(
      screen.getByText('The title must be at most 120 characters.'),
    ).toBeVisible()
    expect(
      screen.getByText('The description must be at most 2000 characters.'),
    ).toBeVisible()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('shows an invalid due date error', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm({
      initial: {
        title: 'Task',
        description: '',
        priority: 'medium',
        due_date: '2026-02-30',
        completed: false,
      },
    })
    await user.click(screen.getByRole('button', { name: 'Save task' }))
    expect(screen.getByText('Enter a valid date.')).toBeVisible()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('shows a server error and cancels', async () => {
    const user = userEvent.setup()
    const { onCancel } = renderForm({ error: 'Server unavailable' })
    expect(screen.getByTestId('alert')).toHaveTextContent('Server unavailable')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('shows progress and disables controls while busy', () => {
    renderForm({ busy: true })
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(screen.getByLabelText(/Task title/)).toBeDisabled()
  })
})
