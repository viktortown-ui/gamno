import { computeIndexDay } from '../analytics/compute'
import { INDEX_METRIC_IDS, METRICS, type MetricId } from '../../metrics'
import type { CheckinRecord } from '../../models/checkin'
import type { InfluenceMatrix } from '../influence/types'
import type { DriverInsight } from '../influence/influence'
import { defaultInfluenceMatrix } from '../influence/influence'

export interface QuestSuggestion {
  title: string
  metricTarget: MetricId
  delta: number
  horizonDays: number
  predictedIndexLift: number
  reasonRu: string
}

export interface CheckinResultInsight {
  index: number
  deltaVsPrevious: number
  topDriver: DriverInsight | null
  bestLever: QuestSuggestion | null
}

const leverTemplates: Record<MetricId, { title: string; delta: number; horizonDays: number }> = {
  energy: { title: 'Поддержать энергию ежедневной прогулкой', delta: 1, horizonDays: 3 },
  focus: { title: 'Закрепить 2 блока глубокой работы', delta: 1, horizonDays: 3 },
  mood: { title: 'Сделать 1 действие для поднятия настроения', delta: 1, horizonDays: 2 },
  stress: { title: 'Снизить стресс короткой разгрузкой', delta: -1, horizonDays: 2 },
  sleepHours: { title: 'Добавить 30 минут сна', delta: 0.5, horizonDays: 3 },
  social: { title: 'Провести качественный разговор', delta: 1, horizonDays: 3 },
  productivity: { title: 'Сделать один приоритет до полудня', delta: 1, horizonDays: 2 },
  health: { title: 'Усилить самочувствие через режим', delta: 1, horizonDays: 3 },
  cashFlow: { title: 'Улучшить денежный поток одной задачей', delta: 5000, horizonDays: 3 },
}

export function buildCheckinResultInsight(
  latest: CheckinRecord,
  previous?: CheckinRecord,
  matrix: InfluenceMatrix = defaultInfluenceMatrix,
): CheckinResultInsight {
  const index = computeIndexDay(latest)
  const deltaVsPrevious = previous ? index - computeIndexDay(previous) : 0
  const topDriver = pickTopDriver(latest, matrix)
  const bestLever = selectBestLever(latest, matrix)

  return {
    index,
    deltaVsPrevious,
    topDriver,
    bestLever,
  }
}

export function selectBestLever(
  base: CheckinRecord,
  matrix: InfluenceMatrix = defaultInfluenceMatrix,
): QuestSuggestion | null {
  const candidates = INDEX_METRIC_IDS.map((metricId) => createLever(metricId, base, matrix))
    .filter((item): item is QuestSuggestion => Boolean(item))

  if (!candidates.length) return null

  return candidates.sort((a, b) => b.predictedIndexLift - a.predictedIndexLift || a.metricTarget.localeCompare(b.metricTarget))[0]
}

function createLever(metricId: MetricId, base: CheckinRecord, matrix: InfluenceMatrix): QuestSuggestion | null {
  const template = leverTemplates[metricId]
  if (!template) return null

  const ownWeight = metricId === 'stress' ? -1.1 : 1
  const edgeImpact = Object.values(matrix[metricId] ?? {}).reduce((sum, weight) => sum + Math.abs(weight), 0)
    const rawLift = Math.abs(template.delta) * (Math.abs(ownWeight) + edgeImpact * 0.35)
  const predictedIndexLift = Number(Math.max(0.1, rawLift).toFixed(2))

  const metricLabel = METRICS.find((metric) => metric.id === metricId)?.labelRu ?? metricId
  const metricValue = base[metricId]
  return {
    title: template.title,
    metricTarget: metricId,
    delta: template.delta,
    horizonDays: template.horizonDays,
    predictedIndexLift,
    reasonRu: `${metricLabel} сейчас на уровне ${metricValue}, это влияет на индекс через прямой вклад и каскад связей.`,
  }
}

function pickTopDriver(base: CheckinRecord, matrix: InfluenceMatrix): DriverInsight | null {
  let top: DriverInsight | null = null

  for (const [from, edges] of Object.entries(matrix) as [MetricId, Partial<Record<MetricId, number>>][]) {
    const baseValue = base[from]
    for (const [to, weight] of Object.entries(edges) as [MetricId, number][]) {
      const strength = Math.abs(baseValue * weight)
      if (!top || strength > top.strength) {
        top = {
          from,
          to,
          weight,
          change: 0,
          strength,
          text: `${labelMetric(from)} сейчас сильнее всего влияет на ${labelMetric(to)}.`,
        }
      }
    }
  }

  return top
}

function labelMetric(metricId: MetricId): string {
  return METRICS.find((metric) => metric.id === metricId)?.labelRu ?? metricId
}
