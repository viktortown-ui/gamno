import { computeIndexDay, computeVolatility } from '../analytics/compute'
import { assessCollapseRisk } from '../../collapse/model'
import { applyImpulse } from '../influence/influence'
import { evaluateGoalScore } from '../goal'
import { METRICS } from '../../metrics'
import type { CheckinRecord } from '../../models/checkin'
import type { GoalRecord } from '../../models/goal'
import type { QuestRecord } from '../../models/quest'
import type { RegimeSnapshotRecord } from '../../models/regime'
import type { DebtBreakdown, TimeDebtEffectEstimate, TimeDebtProtocolAction, TimeDebtRules } from '../../models/timeDebt'
import { dayKeyFromTs } from '../../utils/dayKey'
import type { InfluenceMatrix, MetricVector } from '../influence/types'

export const defaultTimeDebtRules: TimeDebtRules = {
  targets: { sleepHours: 7.5 },
  tolerances: { stressHigh: 6, focusLow: 5 },
  weights: { sleep: 1, recovery: 0.9, focus: 1, social: 0.4 },
  decay: { sleep: 0.88, recovery: 0.9, focus: 0.91, social: 0.9 },
}

export interface DailyDebtPoint {
  dayKey: string
  checkin: CheckinRecord
}

export function buildDailySeries(checkins: CheckinRecord[]): DailyDebtPoint[] {
  const byDay = new Map<string, CheckinRecord>()
  for (const checkin of [...checkins].sort((a, b) => a.ts - b.ts)) {
    byDay.set(dayKeyFromTs(checkin.ts), checkin)
  }
  return Array.from(byDay.entries()).map(([dayKey, checkin]) => ({ dayKey, checkin })).sort((a, b) => a.dayKey.localeCompare(b.dayKey))
}

function clampDebt(value: number): number {
  return Number(Math.max(0, value).toFixed(3))
}

function toMetricVector(checkin: CheckinRecord): MetricVector {
  return METRICS.reduce((acc, metric) => {
    acc[metric.id] = checkin[metric.id]
    return acc
  }, {} as MetricVector)
}

export function computeDebts(
  dailySeries: DailyDebtPoint[],
  quests: QuestRecord[],
  rules: TimeDebtRules,
): DebtBreakdown {
  let sleepDebt = 0
  let recoveryDebt = 0
  let focusDebt = 0
  let socialDebt = 0

  const recoveryCompletions = quests.filter((quest) => quest.status === 'completed' && ['health', 'stress', 'sleepHours', 'recovery'].includes(quest.metricTarget)).length
  const focusMisses = quests.filter((quest) => quest.status === 'active' && ['focus', 'productivity'].includes(quest.metricTarget)).length

  for (const point of dailySeries) {
    const { checkin } = point
    const sleepGap = Math.max(0, rules.targets.sleepHours - checkin.sleepHours)
    sleepDebt = sleepDebt * rules.decay.sleep + sleepGap * rules.weights.sleep

    const recoveryLoad = Math.max(0, checkin.stress - rules.tolerances.stressHigh) * 0.8 + Math.max(0, 6 - checkin.mood) * 0.5 + Math.max(0, 7 - checkin.sleepHours) * 0.4
    recoveryDebt = recoveryDebt * rules.decay.recovery + recoveryLoad * rules.weights.recovery

    const focusLoad = Math.max(0, rules.tolerances.focusLow - checkin.focus) * 0.9 + Math.max(0, checkin.stress - 5) * 0.25
    focusDebt = focusDebt * rules.decay.focus + (focusLoad + focusMisses * 0.25) * rules.weights.focus

    const socialLoad = Math.max(0, 5 - checkin.social) * 0.5
    socialDebt = socialDebt * rules.decay.social + socialLoad * rules.weights.social
  }

  recoveryDebt = Math.max(0, recoveryDebt - recoveryCompletions * 0.8)

  return {
    sleepDebt: clampDebt(sleepDebt),
    recoveryDebt: clampDebt(recoveryDebt),
    focusDebt: clampDebt(focusDebt),
    socialDebt: clampDebt(socialDebt),
  }
}

function explainTop3FromDebts(debts: DebtBreakdown): string[] {
  const entries: Array<[string, number, string]> = [
    ['sleepDebt', debts.sleepDebt, 'Сон ниже цели; долг восстановления растёт.'],
    ['recoveryDebt', debts.recoveryDebt, 'Накоплена нагрузка по стрессу и восстановлению.'],
    ['focusDebt', debts.focusDebt, 'Фокус нестабилен, задачи висят дольше плана.'],
    ['socialDebt', debts.socialDebt ?? 0, 'Социальная подпитка просела.'],
  ]

  return entries
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map((item) => item[2])
}

const actionTemplates: Array<Omit<TimeDebtProtocolAction, 'effect'>> = [
  { actionId: 'discharge-90m', titleRu: 'Разрядка 90 минут: сон + тишина', reasonRu: 'Снижает риск срыва при перегреве.', domain: 'recoveryDebt', supportsGoal: false, isDischarge: true },
  { actionId: 'sleep-window', titleRu: 'Окно сна 7.5ч сегодня', reasonRu: 'Гасит базовый долг сна.', domain: 'sleepDebt', supportsGoal: false, isDischarge: false },
  { actionId: 'focus-sprint', titleRu: 'Спринт фокуса 2×25 минут', reasonRu: 'Сокращает долг незавершённости.', domain: 'focusDebt', supportsGoal: true, isDischarge: false },
  { actionId: 'social-touch', titleRu: 'Короткий контакт с опорным человеком', reasonRu: 'Возвращает устойчивость и поддержку.', domain: 'socialDebt', supportsGoal: false, isDischarge: false },
]

function estimateEffect(base: CheckinRecord, action: Omit<TimeDebtProtocolAction, 'effect'>, matrix: InfluenceMatrix, goal: GoalRecord | null): TimeDebtEffectEstimate {
  const impulses: Partial<Record<keyof MetricVector, number>> = action.actionId === 'sleep-window'
    ? { sleepHours: 0.8, stress: -0.3 }
    : action.actionId === 'discharge-90m'
      ? { stress: -1, mood: 0.6 }
      : action.actionId === 'focus-sprint'
        ? { focus: 0.9, productivity: 0.7 }
        : { social: 0.8, mood: 0.5 }

  const scenario = applyImpulse(toMetricVector(base), impulses, matrix, 1)
  const scenarioCheckin = { ...base, ...scenario }
  const baseIndex = computeIndexDay(base)
  const scenarioIndex = computeIndexDay(scenarioCheckin)
  const volatility = computeVolatility([base], 'energy', 14)
  const baseCollapse = assessCollapseRisk({ ts: base.ts, index: baseIndex, risk: Math.max(0, 10 - baseIndex), volatility, xp: 0, level: 0, entropy: 0, drift: 0, stats: { strength: base.health * 10, intelligence: base.focus * 10, wisdom: base.mood * 10, dexterity: base.energy * 10 } }, base)
  const scenarioCollapse = assessCollapseRisk({ ts: base.ts, index: scenarioIndex, risk: Math.max(0, 10 - scenarioIndex), volatility, xp: 0, level: 0, entropy: 0, drift: 0, stats: { strength: scenarioCheckin.health * 10, intelligence: scenarioCheckin.focus * 10, wisdom: scenarioCheckin.mood * 10, dexterity: scenarioCheckin.energy * 10 } }, scenarioCheckin)

  let deltaGoalScore = 0
  if (goal) {
    const baseGoal = evaluateGoalScore(goal, { index: baseIndex, pCollapse: baseCollapse.pCollapse, entropy: 0, drift: 0, stats: { strength: base.health * 10, intelligence: base.focus * 10, wisdom: base.mood * 10, dexterity: base.energy * 10 }, metrics: toMetricVector(base) })
    const scenarioGoal = evaluateGoalScore(goal, { index: scenarioIndex, pCollapse: scenarioCollapse.pCollapse, entropy: 0, drift: 0, stats: { strength: scenarioCheckin.health * 10, intelligence: scenarioCheckin.focus * 10, wisdom: scenarioCheckin.mood * 10, dexterity: scenarioCheckin.energy * 10 }, metrics: scenario })
    deltaGoalScore = scenarioGoal.goalScore - baseGoal.goalScore
  }

  return {
    deltaIndex: Number((scenarioIndex - baseIndex).toFixed(2)),
    deltaPCollapse: Number((scenarioCollapse.pCollapse - baseCollapse.pCollapse).toFixed(4)),
    deltaGoalScore: Number(deltaGoalScore.toFixed(2)),
  }
}

export function buildProtocol(params: {
  debts: DebtBreakdown
  sirenLevel: RegimeSnapshotRecord['sirenLevel']
  activeGoal: GoalRecord | null
  latestCheckin: CheckinRecord
  matrix: InfluenceMatrix
}): TimeDebtProtocolAction[] {
  const { debts, sirenLevel, activeGoal, latestCheckin, matrix } = params
  const orderedDomains = Object.entries(debts)
    .sort((a, b) => Number(b[1] ?? 0) - Number(a[1] ?? 0))
    .map(([key]) => key as keyof DebtBreakdown)

  const selected: Omit<TimeDebtProtocolAction, 'effect'>[] = []
  if (sirenLevel === 'red') {
    selected.push(actionTemplates[0])
  }

  for (const domain of orderedDomains) {
    const found = actionTemplates.find((item) => item.domain === domain)
    if (found && !selected.some((item) => item.actionId === found.actionId)) {
      selected.push(found)
    }
    if (selected.length >= 3) break
  }

  if (activeGoal && !selected.some((item) => item.supportsGoal)) {
    const goalAction = actionTemplates.find((item) => item.supportsGoal)
    if (goalAction) {
      if (selected.length >= 3) selected[2] = goalAction
      else selected.push(goalAction)
    }
  }

  return selected.slice(0, 3).map((action) => ({ ...action, effect: estimateEffect(latestCheckin, action, matrix, activeGoal) }))
}

export function buildExplainTop3(debts: DebtBreakdown): string[] {
  return explainTop3FromDebts(debts)
}
