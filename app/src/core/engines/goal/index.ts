import { computeIndexDay } from '../analytics/compute'
import { METRICS, type MetricId } from '../../metrics'
import type { GoalRecord } from '../../models/goal'
import type { InfluenceMatrix, MetricVector } from '../influence/types'
import { applyImpulse } from '../influence/influence'

export interface GoalStateInput {
  index: number
  pCollapse: number
  entropy: number
  drift: number
  stats: {
    strength: number
    intelligence: number
    wisdom: number
    dexterity: number
  }
  metrics: MetricVector
  forecast?: {
    p10?: number
    p50?: number
    p90?: number
  }
}

export interface GoalContributor {
  key: string
  title: string
  delta: number
  textRu: string
}

export interface GoalScoreResult {
  goalScore: number
  goalGap: number
  explainTop3: GoalContributor[]
}

export interface GoalActionSuggestion {
  metricId: MetricId
  impulse: number
  titleRu: string
  rationaleRu: string
  deltaGoalScore: number
  deltaIndex: number
  deltaPCollapse: number
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function clamp100(value: number): number {
  return Math.max(0, Math.min(100, value))
}

function goalTarget(goal: GoalRecord): number {
  if (typeof goal.targetIndex === 'number') return goal.targetIndex
  return 70
}

function gapToText(metricId: MetricId, gap: number): string {
  const label = METRICS.find((metric) => metric.id === metricId)?.labelRu ?? metricId
  const direction = gap >= 0 ? 'выше цели' : 'ниже цели'
  return `${label}: ${Math.abs(gap).toFixed(2)} ${direction}.`
}

export function evaluateGoalScore(goal: GoalRecord, currentState: GoalStateInput): GoalScoreResult {
  const contributors: GoalContributor[] = []
  let score = 50

  const targetIdx = goalTarget(goal)
  const indexGap = currentState.index - targetIdx
  score += indexGap * 5
  contributors.push({
    key: 'index',
    title: 'Индекс',
    delta: indexGap * 5,
    textRu: `Отклонение индекса от цели: ${indexGap >= 0 ? '+' : ''}${indexGap.toFixed(2)}.`,
  })

  const collapseTarget = goal.targetPCollapse ?? goal.constraints?.maxPCollapse ?? 0.25
  const collapseGap = collapseTarget - currentState.pCollapse
  score += collapseGap * 80
  contributors.push({
    key: 'pCollapse',
    title: 'Риск коллапса',
    delta: collapseGap * 80,
    textRu: `Запас по P(collapse): ${(collapseGap * 100).toFixed(1)} п.п.`,
  })

  if (typeof goal.constraints?.maxEntropy === 'number') {
    const entropyGap = goal.constraints.maxEntropy - currentState.entropy
    score += entropyGap * 10
    contributors.push({
      key: 'entropy',
      title: 'Энтропия',
      delta: entropyGap * 10,
      textRu: `Энтропия относительно порога: ${entropyGap >= 0 ? '+' : ''}${entropyGap.toFixed(2)}.`,
    })
  }

  for (const [metricId, weight] of Object.entries(goal.weights) as [MetricId, number][]) {
    const metricValue = currentState.metrics[metricId] ?? 0
    const normalized = METRICS.find((m) => m.id === metricId)
    if (!normalized) continue
    const center = (normalized.max + normalized.min) / 2
    const spread = Math.max(1, normalized.max - normalized.min)
    const gap = (metricValue - center) / spread
    const contribution = weight * gap * 40
    score += contribution
    contributors.push({
      key: metricId,
      title: normalized.labelRu,
      delta: contribution,
      textRu: gapToText(metricId, gap),
    })
  }

  if (currentState.forecast?.p50 !== undefined) {
    const forecastGap = currentState.forecast.p50 - targetIdx
    const forecastDelta = forecastGap * 2.5
    score += forecastDelta
    contributors.push({
      key: 'forecast',
      title: 'Прогноз p50',
      delta: forecastDelta,
      textRu: `Прогноз p50 к горизонту: ${forecastGap >= 0 ? '+' : ''}${forecastGap.toFixed(2)} к цели.`,
    })
  }

  const top3 = [...contributors].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 3)
  const finalScore = clamp100(score)

  return {
    goalScore: finalScore,
    goalGap: finalScore - 70,
    explainTop3: top3,
  }
}

function applyMetricDelta(metrics: MetricVector, metricId: MetricId, delta: number): MetricVector {
  const config = METRICS.find((item) => item.id === metricId)
  if (!config) return metrics
  return {
    ...metrics,
    [metricId]: Math.max(config.min, Math.min(config.max, metrics[metricId] + delta)),
  }
}

function inferPCollapse(metrics: MetricVector): number {
  const stress = clamp01((metrics.stress ?? 0) / 10)
  const sleepPenalty = clamp01(1 - (metrics.sleepHours ?? 0) / 8)
  const energyPenalty = clamp01(1 - (metrics.energy ?? 0) / 10)
  return clamp01(0.1 + stress * 0.5 + sleepPenalty * 0.25 + energyPenalty * 0.2)
}

function indexFromMetrics(metrics: MetricVector): number {
  return computeIndexDay({ ts: 0, ...metrics })
}

export function suggestGoalActions(goal: GoalRecord, currentState: GoalStateInput, matrix: InfluenceMatrix): GoalActionSuggestion[] {
  const baseline = evaluateGoalScore(goal, currentState)

  const candidates = METRICS.filter((metric) => metric.id !== 'cashFlow')
    .flatMap((metric) => ([1, -1] as const).map((impulse) => ({ metricId: metric.id, impulse })))

  return candidates.map((candidate) => {
    const impulses = { [candidate.metricId]: candidate.impulse }
    const scenario = applyImpulse(currentState.metrics, impulses, matrix, 1)
    const scenarioMetrics = applyMetricDelta(scenario, candidate.metricId, candidate.impulse * 0.2)

    const scenarioState: GoalStateInput = {
      ...currentState,
      metrics: scenarioMetrics,
      index: indexFromMetrics(scenarioMetrics),
      pCollapse: inferPCollapse(scenarioMetrics),
    }

    const scenarioScore = evaluateGoalScore(goal, scenarioState)

    return {
      metricId: candidate.metricId,
      impulse: candidate.impulse,
      titleRu: `${candidate.impulse > 0 ? 'Усилить' : 'Снизить'} ${METRICS.find((m) => m.id === candidate.metricId)?.labelRu ?? candidate.metricId}`,
      rationaleRu: `Рычаг влияет на индекс и риск, затем распространяется по матрице взаимовлияния.`,
      deltaGoalScore: Number((scenarioScore.goalScore - baseline.goalScore).toFixed(2)),
      deltaIndex: Number((scenarioState.index - currentState.index).toFixed(2)),
      deltaPCollapse: Number((scenarioState.pCollapse - currentState.pCollapse).toFixed(4)),
    }
  })
    .sort((a, b) => b.deltaGoalScore - a.deltaGoalScore)
    .slice(0, 3)
}
