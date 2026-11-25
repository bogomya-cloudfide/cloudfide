import type { Todo, TodoStats } from './types.js';

// Calendar dates in YYYY-MM-DD form compare correctly as strings.
export function isOverdue(todo: Pick<Todo, 'completed' | 'due_date'>, today: string): boolean {
  return !todo.completed && todo.due_date !== null && todo.due_date < today;
}

export function summarizeTodos(todos: Todo[], now: Date = new Date()): TodoStats {
  const today = now.toISOString().slice(0, 10);
  const completed = todos.filter((todo) => todo.completed).length;
  return {
    total: todos.length,
    active: todos.length - completed,
    completed,
    overdue: todos.filter((todo) => isOverdue(todo, today)).length,
  };
}
