import { afterEach, it, expect, vi } from 'vitest';
import { isOverdue, summarizeTodos } from '../src/features/todos/stats.ts';
import { todo } from './fixture.ts';

afterEach(() => vi.useRealTimers());

it('is overdue only for open tasks due strictly before today', () => {
  expect(isOverdue({ completed: false, due_date: '2026-10-14' }, '2026-10-15')).toBe(true);
  expect(isOverdue({ completed: false, due_date: '2026-10-15' }, '2026-10-15')).toBe(false);
  expect(isOverdue({ completed: false, due_date: null }, '2026-10-15')).toBe(false);
  expect(isOverdue({ completed: true, due_date: '2026-10-14' }, '2026-10-15')).toBe(false);
});

it('summarizes totals and overdue tasks relative to the given date', () => {
  const todos = [
    { ...todo, id: 1, due_date: '2026-10-14' },
    { ...todo, id: 2, due_date: '2026-10-15' },
    { ...todo, id: 3, due_date: '2026-10-01', completed: true },
    { ...todo, id: 4, due_date: null },
  ];
  expect(summarizeTodos(todos, new Date('2026-10-15T08:00:00Z'))).toEqual({ total: 4, active: 3, completed: 1, overdue: 1 });
});

it('summarizes an empty list as zeros', () => {
  expect(summarizeTodos([], new Date('2026-10-15T08:00:00Z'))).toEqual({ total: 0, active: 0, completed: 0, overdue: 0 });
});

it('uses the current UTC date by default', () => {
  vi.setSystemTime(new Date('2026-10-15T23:30:00Z'));
  const todos = [{ ...todo, id: 1, due_date: '2026-10-14' }, { ...todo, id: 2, due_date: '2026-10-15' }];
  expect(summarizeTodos(todos).overdue).toBe(1);
});
