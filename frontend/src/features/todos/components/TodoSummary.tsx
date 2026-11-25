import { Badge } from '../../../design-system'
import type { TodoStats } from '../types'

export function TodoSummary({ stats }: { stats?: TodoStats }) {
  if (!stats) return null
  return (
    <section className="row compact" aria-label="Task summary">
      <Badge variant="neutral">Total: {stats.total}</Badge>
      <Badge variant="info">To do: {stats.active}</Badge>
      <Badge variant="success">Completed: {stats.completed}</Badge>
      <Badge variant={stats.overdue > 0 ? 'warning' : 'neutral'}>
        Overdue: {stats.overdue}
      </Badge>
    </section>
  )
}
