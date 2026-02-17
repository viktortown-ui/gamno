import { METRICS, type MetricId } from '../../metrics'
import { listInfluenceEdges, type InfluenceEdge } from './influence'
import type { InfluenceMatrix } from './types'

export interface GraphFilters {
  source?: MetricId | 'all'
  target?: MetricId | 'all'
  sign?: 'all' | 'positive' | 'negative'
  threshold?: number
  search?: string
  topN?: number
}

export function getTopEdges(matrix: InfluenceMatrix, filters: GraphFilters): InfluenceEdge[] {
  const query = (filters.search ?? '').trim().toLowerCase()
  const labels = METRICS.reduce<Record<string, string>>((acc, metric) => {
    acc[metric.id] = metric.labelRu.toLowerCase()
    return acc
  }, {})

  const filtered = listInfluenceEdges(matrix)
    .filter((edge) => (filters.source && filters.source !== 'all' ? edge.from === filters.source : true))
    .filter((edge) => (filters.target && filters.target !== 'all' ? edge.to === filters.target : true))
    .filter((edge) => {
      if (filters.sign === 'positive') return edge.weight > 0
      if (filters.sign === 'negative') return edge.weight < 0
      return true
    })
    .filter((edge) => edge.absWeight >= (filters.threshold ?? 0))
    .filter((edge) => {
      if (!query) return true
      return labels[edge.from]?.includes(query) || labels[edge.to]?.includes(query)
    })
    .sort((a, b) => b.absWeight - a.absWeight || b.weight - a.weight || a.from.localeCompare(b.from) || a.to.localeCompare(b.to))

  return filtered.slice(0, filters.topN ?? 15)
}
