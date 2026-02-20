import { METRICS, type MetricId } from '../../metrics'
import { computeIndexDay } from '../analytics/compute'
import { applyImpulse, clampMetric } from '../influence/influence'
import type { MetricVector } from '../influence/types'
import type { HedgeSuggestion, PathPoint, TailMetrics } from './types'

function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  const position = (sorted.length - 1) * q
  const base = Math.floor(position)
  const rest = position - base
  if (sorted[base + 1] === undefined) return sorted[base]
  return sorted[base] + rest * (sorted[base + 1] - sorted[base])
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

export function goalScoreOf(vector: MetricVector, weights?: Partial<Record<MetricId, number>>): number | undefined {
  if (!weights || !Object.keys(weights).length) return undefined
  let weighted = 0
  let totalW = 0
  for (const metric of METRICS) {
    const w = Math.max(0, weights[metric.id] ?? 0)
    if (!w) continue
    const normalized = clamp01((vector[metric.id] - metric.min) / (metric.max - metric.min || 1))
    weighted += normalized * w
    totalW += w
  }
  if (!totalW) return undefined
  return Number(((weighted / totalW) * 100).toFixed(3))
}

export function summarizeTail(paths: PathPoint[][], indexFloor: number, baseIndex: number, basePCollapse: number, baseGoal?: number): TailMetrics {
  const last = paths.map((path) => path.at(-1)!)
  const horizonIndex = last.map((point) => point.index)
  const horizonGoal = last.map((point) => point.goalScore).filter((v): v is number => typeof v === 'number')
  const horizonCollapse = last.map((point) => point.pCollapse)

  const redAny = paths.filter((path) => path.some((point) => point.siren === 'red')).length / paths.length
  const floorAny = paths.filter((path) => path.some((point) => point.index < indexFloor)).length / paths.length
  const belowAtHorizon = horizonIndex.filter((value) => value < indexFloor).length / Math.max(horizonIndex.length, 1)
  const cvarCut = quantile(horizonIndex, 0.05)
  const tailBucket = horizonIndex.filter((value) => value <= cvarCut)
  const cvar = tailBucket.length ? tailBucket.reduce((sum, v) => sum + v, 0) / tailBucket.length : cvarCut

  return {
    redSirenAny: Number(redAny.toFixed(4)),
    indexFloorBreachAny: Number(floorAny.toFixed(4)),
    probabilityIndexBelowFloorAtHorizon: Number(belowAtHorizon.toFixed(4)),
    expectedDeltaIndex: Number((horizonIndex.reduce((s, v) => s + v, 0) / Math.max(horizonIndex.length, 1) - baseIndex).toFixed(4)),
    expectedDeltaGoalScore: Number(((horizonGoal.length ? horizonGoal.reduce((s, v) => s + v, 0) / horizonGoal.length : baseGoal ?? 0) - (baseGoal ?? 0)).toFixed(4)),
    expectedDeltaPCollapse: Number((horizonCollapse.reduce((s, v) => s + v, 0) / Math.max(horizonCollapse.length, 1) - basePCollapse).toFixed(4)),
    cvar5Index: Number(cvar.toFixed(4)),
  }
}

export function rankHedges(base: MetricVector, matrix: Record<MetricId, Partial<Record<MetricId, number>>>, indexFloor: number): HedgeSuggestion[] {
  const baseIndex = computeIndexDay({ ...base, ts: 0 })
  const candidates = METRICS
    .filter((metric) => metric.id !== 'cashFlow')
    .map((metric) => {
      const improved = applyImpulse(base, { [metric.id]: 0.5 }, matrix, 2)
      const newIndex = computeIndexDay({ ...improved, ts: 0 })
      const stressPenalty = Math.max(0, indexFloor - newIndex) - Math.max(0, indexFloor - baseIndex)
      const riskGain = (newIndex - baseIndex) - stressPenalty
      return {
        metricId: metric.id,
        delta: 0.5,
        tailRiskImprovement: Number(riskGain.toFixed(4)),
        noteRu: `Сдвиг «${metric.labelRu}» на +0.5 стабилизирует хвост через контур влияний.`,
      }
    })

  return candidates
    .sort((a, b) => b.tailRiskImprovement - a.tailRiskImprovement)
    .slice(0, 3)
}

export function applyBoundedPropagation(base: MetricVector, impulses: Partial<Record<MetricId, number>>, matrix: Record<MetricId, Partial<Record<MetricId, number>>>): MetricVector {
  const next = applyImpulse(base, impulses, matrix, 2)
  const clamped = { ...next }
  for (const metric of METRICS) {
    clamped[metric.id] = clampMetric(metric.id, next[metric.id])
  }
  return clamped
}
