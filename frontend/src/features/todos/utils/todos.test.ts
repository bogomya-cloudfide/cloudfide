import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatDate, isOverdue, selectTodos, validateTodo } from './todos'
import type { Todo } from '../types'

const base: Todo = {
  id: 1,
  title: 'Sprint plan',
  description: '',
  priority: 'medium',
  completed: false,
  due_date: null,
  created_at: '2026-10-01T12:00:00Z',
  updated_at: '2026-10-01T12:00:00Z',
}

describe('selectTodos', () => {
  it('combines status with a case-insensitive search in the description', () => {
    const matching = { ...base, description: 'Discuss the API' }
    const todos = [
      matching,
      { ...matching, id: 2, completed: true },
      { ...base, id: 3 },
    ]
    expect(selectTodos(todos, 'active', ' api ', 'newest')).toEqual([matching])
  })

  it('sorts by priority without changing the source array', () => {
    const high: Todo = { ...base, id: 2, priority: 'high' }
    const todos = [base, high]
    expect(selectTodos(todos, 'all', '', 'priority')).toEqual([high, base])
    expect(todos).toEqual([base, high])
  })

  it('sorts by due date with undated tasks last', () => {
    const early: Todo = { ...base, id: 2, due_date: '2026-10-01' }
    const late: Todo = { ...base, id: 3, due_date: '2026-11-01' }
    expect(selectTodos([base, late, early], 'all', '', 'due')).toEqual([
      early,
      late,
      base,
    ])
  })

  it('breaks priority and due date ties by newest id', () => {
    const a: Todo = { ...base, id: 2, due_date: '2026-10-01' }
    const b: Todo = { ...base, id: 3, due_date: '2026-10-01' }
    expect(selectTodos([a, b], 'all', '', 'priority')).toEqual([b, a])
    expect(selectTodos([a, b], 'all', '', 'due')).toEqual([b, a])
  })

  it('breaks ties between undated tasks by newest id', () => {
    const other: Todo = { ...base, id: 2 }
    expect(selectTodos([base, other], 'all', '', 'due')).toEqual([other, base])
  })

  it('sorts newest first and breaks ties by id', () => {
    const newer: Todo = { ...base, id: 2, created_at: '2026-10-02T12:00:00Z' }
    const tie: Todo = { ...base, id: 3 }
    expect(selectTodos([base, newer, tie], 'all', '', 'newest')).toEqual([
      newer,
      tie,
      base,
    ])
  })

  it('shows only completed tasks for the completed filter', () => {
    const done: Todo = { ...base, id: 2, completed: true }
    expect(selectTodos([base, done], 'completed', '', 'newest')).toEqual([done])
  })
})

describe('selectTodos overdue filter', () => {
  afterEach(() => vi.useRealTimers())

  it('keeps only open tasks due before today', () => {
    vi.setSystemTime(new Date(2026, 9, 15, 12))
    const late: Todo = { ...base, id: 2, due_date: '2026-10-14' }
    const today: Todo = { ...base, id: 3, due_date: '2026-10-15' }
    const doneLate: Todo = { ...late, id: 4, completed: true }
    const todos = [base, late, today, doneLate]
    expect(selectTodos(todos, 'overdue', '', 'newest')).toEqual([late])
  })
})

describe('validateTodo', () => {
  const valid = {
    title: 'Task',
    description: '',
    priority: 'low' as const,
    due_date: null,
    completed: false,
  }

  it('accepts a valid task', () => {
    expect(validateTodo({ ...valid, due_date: '2026-02-28' })).toEqual({})
  })

  it('rejects a blank title', () => {
    expect(validateTodo({ ...valid, title: '   ' })).toEqual({
      title: 'Enter a task title.',
    })
  })

  it('enforces the title and description length limits', () => {
    expect(validateTodo({ ...valid, title: 'a'.repeat(120) })).toEqual({})
    expect(validateTodo({ ...valid, title: 'a'.repeat(121) })).toEqual({
      title: 'The title must be at most 120 characters.',
    })
    expect(validateTodo({ ...valid, description: 'a'.repeat(2000) })).toEqual(
      {},
    )
    expect(validateTodo({ ...valid, description: 'a'.repeat(2001) })).toEqual({
      description: 'The description must be at most 2000 characters.',
    })
  })

  it('rejects malformed and non-existent dates', () => {
    const error = { due_date: 'Enter a valid date.' }
    expect(validateTodo({ ...valid, due_date: '2026-02-30' })).toEqual(error)
    expect(validateTodo({ ...valid, due_date: '10/15/2026' })).toEqual(error)
  })
})

describe('isOverdue', () => {
  afterEach(() => vi.useRealTimers())

  it('is overdue only for open tasks due before today', () => {
    vi.setSystemTime(new Date(2026, 9, 15, 12))
    expect(isOverdue({ ...base, due_date: '2026-10-14' })).toBe(true)
    expect(isOverdue({ ...base, due_date: '2026-10-15' })).toBe(false)
    expect(isOverdue({ ...base, due_date: null })).toBe(false)
    expect(
      isOverdue({ ...base, due_date: '2026-10-14', completed: true }),
    ).toBe(false)
  })
})

describe('formatDate', () => {
  it('formats a date in en-GB style', () => {
    expect(formatDate('2026-10-05')).toBe('5 Oct 2026')
  })
})
