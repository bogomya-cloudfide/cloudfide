export type Priority = 'low' | 'medium' | 'high'
/** A calendar date, `YYYY-MM-DD`. */
export type IsoDate = string
/** A timestamp in ISO 8601 format. */
export type IsoDateTime = string
export interface TodoInput {
  title: string
  description: string
  priority: Priority
  due_date: IsoDate | null
  completed: boolean
}
export interface Todo extends TodoInput {
  id: number
  created_at: IsoDateTime
  updated_at: IsoDateTime
}
export type Filter = 'all' | 'active' | 'completed'
export type Sort = 'newest' | 'priority' | 'due'
