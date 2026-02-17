import { METRICS, type MetricId } from '../../metrics'
import type { InfluenceMatrix, MetricVector } from './types'

export interface InfluenceEdge {
  from: MetricId
  to: MetricId
  weight: number
  absWeight: number
}

export interface DriverInsight {
  from: MetricId
  to: MetricId
  weight: number
  change: number
  strength: number
  text: string
}

export const defaultInfluenceMatrix: InfluenceMatrix = {
  energy: { focus: 0.4, mood: 0.3, productivity: 0.5 },
  focus: { productivity: 0.6, stress: -0.2 },
  mood: { stress: -0.5, social: 0.3 },
  stress: { energy: -0.5, sleepHours: -0.4, mood: -0.4 },
  sleepHours: { energy: 0.6, focus: 0.3, stress: -0.4 },
  social: { mood: 0.4, stress: -0.2 },
  productivity: { mood: 0.2, energy: -0.1 },
  health: { energy: 0.4, mood: 0.3, stress: -0.3 },
  cashFlow: { mood: 0.1, stress: -0.1 },
}

export function clampMetric(metricId: MetricId, value: number): number {
  const config = METRICS.find((item) => item.id === metricId)
  if (!config) return value
  return Math.min(config.max, Math.max(config.min, value))
}

export function applyImpulse(
  baseVector: MetricVector,
  impulses: Partial<Record<MetricId, number>>,
  influenceMatrix: InfluenceMatrix,
  steps = 2,
): MetricVector {
  const next = { ...baseVector }
  for (const [metricId, delta] of Object.entries(impulses) as [MetricId, number][]) {
    next[metricId] = clampMetric(metricId, next[metricId] + delta)
  }

  for (let step = 0; step < steps; step += 1) {
    const updates: Partial<Record<MetricId, number>> = {}
    for (const from of Object.keys(influenceMatrix) as MetricId[]) {
      const edges = influenceMatrix[from]
      for (const to of Object.keys(edges) as MetricId[]) {
        updates[to] = (updates[to] ?? 0) + (edges[to] ?? 0) * ((next[from] - baseVector[from]) / 2)
      }
    }
    for (const [metricId, delta] of Object.entries(updates) as [MetricId, number][]) {
      next[metricId] = clampMetric(metricId, next[metricId] + delta)
    }
  }

  return next
}

export function listInfluenceEdges(matrix: InfluenceMatrix): InfluenceEdge[] {
  const edges: InfluenceEdge[] = []
  for (const from of Object.keys(matrix) as MetricId[]) {
    for (const to of Object.keys(matrix[from]) as MetricId[]) {
      const weight = matrix[from][to] ?? 0
      edges.push({ from, to, weight, absWeight: Math.abs(weight) })
    }
  }
  return edges
}

export function explainDrivers(
  result: MetricVector,
  base: MetricVector,
  matrix: InfluenceMatrix,
  limit = 5,
): string[] {
  return explainDriverInsights(result, base, matrix, limit).map((d) => d.text)
}

export function explainDriverInsights(
  result: MetricVector,
  base: MetricVector,
  matrix: InfluenceMatrix,
  limit = 5,
): DriverInsight[] {
  const drivers: DriverInsight[] = []
  for (const from of Object.keys(matrix) as MetricId[]) {
    for (const to of Object.keys(matrix[from]) as MetricId[]) {
      const change = result[from] - base[from]
      const weight = matrix[from][to] ?? 0
      const strength = Math.abs(change * weight)
      if (strength > 0.1) {
        drivers.push({
          from,
          to,
          weight,
          change,
          strength,
          text: `${label(from)} ${change >= 0 ? '↑' : '↓'} → ${label(to)} ${weight >= 0 ? 'усиливает' : 'ослабляет'}`,
        })
      }
    }
  }

  return drivers
    .sort((a, b) => b.strength - a.strength || Math.abs(b.weight) - Math.abs(a.weight) || a.from.localeCompare(b.from) || a.to.localeCompare(b.to))
    .slice(0, limit)
}

function label(metricId: MetricId): string {
  return METRICS.find((item) => item.id === metricId)?.labelRu ?? metricId
}
