import { METRICS, type MetricId } from '../../metrics'
import { computeTailRisk } from '../../risk/tailRisk'
import { computeIndexDay } from '../analytics/compute'
import { applyImpulse, clampMetric } from '../influence/influence'
import type { MetricVector } from '../influence/types'
import type { HedgeSuggestion, PathPoint, TailMetrics } from './types'

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
  const last = paths.map((path) => path.at(-1)).filter((v): v is PathPoint => Boolean(v))
  const horizonIndex = last.map((point) => point.index)
  const horizonGoal = last.map((point) => point.goalScore).filter((v): v is number => typeof v === 'number')
  const horizonCollapse = last.map((point) => point.pCollapse)

  const redAny = paths.filter((path) => path.some((point) => point.siren === 'red')).length / Math.max(paths.length, 1)
  const floorAny = paths.filter((path) => path.some((point) => point.index < indexFloor)).length / Math.max(paths.length, 1)
  const belowAtHorizon = horizonIndex.filter((value) => value < indexFloor).length / Math.max(horizonIndex.length, 1)

  const indexLosses = horizonIndex.map((value) => Math.max(0, baseIndex - value))
  const collapseLosses = horizonCollapse.map((value) => Math.max(0, value))
  const indexLossTail = computeTailRisk(indexLosses, 0.95)
  const collapseTail = computeTailRisk(collapseLosses, 0.95)

  return {
    redSirenAny: Number(redAny.toFixed(4)),
    indexFloorBreachAny: Number(floorAny.toFixed(4)),
    probabilityIndexBelowFloorAtHorizon: Number(belowAtHorizon.toFixed(4)),
    expectedDeltaIndex: Number((horizonIndex.reduce((s, v) => s + v, 0) / Math.max(horizonIndex.length, 1) - baseIndex).toFixed(4)),
    expectedDeltaGoalScore: Number(((horizonGoal.length ? horizonGoal.reduce((s, v) => s + v, 0) / horizonGoal.length : baseGoal ?? 0) - (baseGoal ?? 0)).toFixed(4)),
    expectedDeltaPCollapse: Number((horizonCollapse.reduce((s, v) => s + v, 0) / Math.max(horizonCollapse.length, 1) - basePCollapse).toFixed(4)),
    var5IndexLoss: Number(indexLossTail.var.toFixed(4)),
    cvar5IndexLoss: Number(indexLossTail.es.toFixed(4)),
    var5Collapse: Number(collapseTail.var.toFixed(4)),
    cvar5Collapse: Number(collapseTail.es.toFixed(4)),
    indexLossTail: { ...indexLossTail, var: Number(indexLossTail.var.toFixed(4)), es: Number(indexLossTail.es.toFixed(4)), tailMean: Number(indexLossTail.tailMean.toFixed(4)), tailMass: Number(indexLossTail.tailMass.toFixed(6)) },
    collapseTail: { ...collapseTail, var: Number(collapseTail.var.toFixed(4)), es: Number(collapseTail.es.toFixed(4)), tailMean: Number(collapseTail.tailMean.toFixed(4)), tailMass: Number(collapseTail.tailMass.toFixed(6)) },
  }
}

export function rankHedges(base: MetricVector, matrix: Record<MetricId, Partial<Record<MetricId, number>>>, indexFloor: number, pCollapseConstraintPct: number): HedgeSuggestion[] {
  const baseIndex = computeIndexDay({ ...base, ts: 0 })
  const candidates = METRICS
    .filter((metric) => metric.id !== 'cashFlow')
    .map((metric) => {
      const improved = applyImpulse(base, { [metric.id]: 0.5 }, matrix, 2)
      const newIndex = computeIndexDay({ ...improved, ts: 0 })
      const stressPenalty = Math.max(0, indexFloor - newIndex) - Math.max(0, indexFloor - baseIndex)
      const collapsePenalty = Math.max(0, (pCollapseConstraintPct / 100) - 0.2) * 10
      const riskGain = (newIndex - baseIndex) - stressPenalty - collapsePenalty
      return {
        metricId: metric.id,
        delta: 0.5,
        tailRiskImprovement: Number(riskGain.toFixed(4)),
        noteRu: `Сдвиг «${metric.labelRu}» на +0.5 улучшает хвост распределения.`,
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
