import { act, renderHook } from '@testing-library/react'
import { expect, it } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { useTodoFilters } from './useTodoFilters'

const done = { ...todoFixture, id: 8, title: 'Write report', completed: true }
const todos = [todoFixture, done]

it('starts with default filter, search and sort', () => {
  const { result } = renderHook(() => useTodoFilters(todos))
  expect(result.current.filter).toBe('all')
  expect(result.current.search).toBe('')
  expect(result.current.sort).toBe('newest')
  expect(result.current.visible).toHaveLength(2)
})

it('narrows visible tasks by filter and search', () => {
  const { result } = renderHook(() => useTodoFilters(todos))
  act(() => result.current.setFilter('completed'))
  expect(result.current.filter).toBe('completed')
  expect(result.current.visible).toEqual([done])
  act(() => result.current.setFilter('all'))
  act(() => result.current.setSearch('demo'))
  expect(result.current.search).toBe('demo')
  expect(result.current.visible).toEqual([todoFixture])
})
