import { METRICS } from '../../core/metrics'
import { evaluateGoalScore, type GoalStateInput } from '../../core/engines/goal'
import type { GoalRecord, MissionStatus } from '../../core/models/goal'
import type { TimeDebtSnapshotRecord } from '../../core/models/timeDebt'
import type { SocialRadarResult } from '../../core/models/socialRadar'
import type { BlackSwanRunRecord } from '../../repo/blackSwanRepo'

export type GoalProfileStatus = 'active' | 'paused' | 'archived' | 'at_risk'

export interface GoalProfile {
  id: string
  title: string
  status: GoalProfileStatus
  importance: number
  horizonDays: number
  successValue: number
  failCost: number
  timeCost: number
  energyCost: number
  debtCost: number
  riskScore: number
  linkageScore: number
  conflictScore: number
  supportScore: number
  progressScore: number
  momentumScore: number
  inactionCost: number
  nextBestActionId?: string
  blockers: string[]
  supporters: string[]
  dependencies: string[]
  conflicts: string[]
  warnings: string[]
  diagnosis: {
    weakSpot: string
    why: string
    mainBlocker: string
    mainSupport: string
    mainConflict: string
    confidence: 'low' | 'medium' | 'high'
  }
  prognosis: {
    idle: PrognosisLine
    takeStep: PrognosisLine
    delay3d: PrognosisLine
  }
  decision: {
    actionTitle: string
    whyBest: string
    effect: string
    timeCostLabel: string
    energyCostLabel: string
    sideEffect: string
  }
  constraints: string[]
  branches: Array<{ name: string; role: 'поддержка' | 'риск' | 'зависимость'; strength: 'слабая' | 'средняя' | 'сильная' }>
  preliminary: boolean
}

interface PrognosisLine {
  riskDelta: number
  debtDelta: number
  momentumDelta: number
  verdict: string
}

const clamp100 = (value: number): number => Math.max(0, Math.min(100, Math.round(value)))

export function horizonUrgency(horizonDays: number): number {
  if (horizonDays <= 3) return 100
  if (horizonDays <= 7) return 80
  if (horizonDays <= 14) return 65
  if (horizonDays <= 30) return 45
  return 25
}

export function scoreLabel(value: number, low = 'низкая', mid = 'средняя', high = 'высокая'): string {
  if (value < 40) return low
  if (value < 70) return mid
  return high
}

export function energyLabel(value: number): string {
  if (value < 35) return 'низкая энергия'
  if (value < 70) return 'средняя энергия'
  return 'высокая энергия'
}

export function formatCostLabel(value: number): string {
  if (value < 35) return 'дёшево'
  if (value < 70) return 'средне'
  return 'дорого'
}

function missionStatus(goal: GoalRecord): MissionStatus | null {
  const mission = goal.missions?.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0]
  return mission?.status ?? null
}

function topMetrics(goal: GoalRecord): string[] {
  const weights = goal.isManualTuning ? (goal.manualTuning?.weights ?? goal.weights) : goal.weights
  return Object.entries(weights)
    .sort((a, b) => Math.abs((b[1] ?? 0)) - Math.abs((a[1] ?? 0)))
    .slice(0, 5)
    .map(([metricId]) => METRICS.find((metric) => metric.id === metricId)?.labelRu ?? metricId)
}

export function buildGoalProfile(params: {
  goal: GoalRecord
  allGoals: GoalRecord[]
  goalState: GoalStateInput | null
  debtSnapshot?: TimeDebtSnapshotRecord
  socialInsight?: SocialRadarResult
  blackSwanRun?: BlackSwanRunRecord
  nextMissionTitle?: string
  diagnosisReason?: string
  weakestMetricLabel?: string
  historyTrend?: 'up' | 'down' | null
}): GoalProfile {
  const { goal, allGoals, goalState, debtSnapshot, socialInsight, blackSwanRun, nextMissionTitle, diagnosisReason, weakestMetricLabel, historyTrend } = params
  const scoring = goalState ? evaluateGoalScore(goal, goalState) : null
  const linkCount = goal.links?.length ?? 0
  const supportCount = goal.links?.filter((link) => link.type === 'supports').length ?? 0
  const dependencyCount = goal.links?.filter((link) => link.type === 'depends_on').length ?? 0
  const conflictCount = goal.links?.filter((link) => link.type === 'conflicts').length ?? 0
  const horizon = goal.manualTuning?.horizonDays ?? goal.horizonDays
  const urgency = horizonUrgency(horizon)
  const goalMetrics = topMetrics(goal)

  const baseImportance = clamp100(45 + linkCount * 7 + Math.abs((goal.weights.focus ?? 0) * 15) + Math.abs((goal.weights.productivity ?? 0) * 10) + (goal.template === 'money' ? 8 : 0))
  const successValue = clamp100(50 + (scoring ? Math.max(-15, Math.min(20, scoring.goalScore - 50)) : 0) + supportCount * 6)
  const failCost = clamp100(40 + urgency * 0.35 + conflictCount * 10 + dependencyCount * 8)
  const timeCost = clamp100(30 + urgency * 0.4 + dependencyCount * 9)
  const energyCost = clamp100(25 + Math.abs((goal.weights.stress ?? 0) * 45) + Math.abs((goal.weights.energy ?? 0) * 35) + (goalState ? Math.max(0, (6 - (goalState.metrics.energy ?? 6)) * 6) : 10))
  const debtCost = clamp100((debtSnapshot?.totals.totalDebt ?? 0) * 12 + dependencyCount * 10 + urgency * 0.3)
  const blackSwanRisk = blackSwanRun ? Math.round((blackSwanRun.summary.probEverRed ?? 0) * 100) : 0
  const riskScore = clamp100((goalState?.pCollapse ?? 0.2) * 100 * 0.5 + (scoring ? Math.max(0, scoring.goalGap + 8) * 3 : 18) + conflictCount * 9 + blackSwanRisk * 0.15)
  const linkageScore = clamp100(20 + linkCount * 14 + dependencyCount * 7)
  const conflictScore = clamp100(conflictCount * 28 + Math.max(0, riskScore - 55) * 0.25)
  const supportScore = clamp100(supportCount * 28 + (socialInsight ? 8 : 0) + Math.max(0, 65 - riskScore) * 0.35)
  const progressScore = clamp100(scoring ? scoring.goalScore : 45)
  const momentumScore = clamp100(historyTrend === 'up' ? 72 : historyTrend === 'down' ? 34 : 50)
  const inactionCost = clamp100(0.35 * failCost + 0.25 * debtCost + 0.2 * riskScore + 0.1 * linkageScore + 0.1 * urgency)

  const conflicts = (goal.links ?? [])
    .filter((link) => link.type === 'conflicts')
    .map((link) => allGoals.find((item) => item.id === link.toGoalId)?.title ?? 'Неизвестный конфликт')
  const dependencies = (goal.links ?? [])
    .filter((link) => link.type === 'depends_on')
    .map((link) => allGoals.find((item) => item.id === link.toGoalId)?.title ?? 'Неизвестная зависимость')
  const supporters = (goal.links ?? [])
    .filter((link) => link.type === 'supports')
    .map((link) => allGoals.find((item) => item.id === link.toGoalId)?.title ?? 'Локальная поддержка')

  const blockers = [
    dependencyCount > 0 ? `Критичные зависимости: ${dependencyCount}` : 'Нужен стабильный слот времени',
    energyCost > 65 ? 'Высокая энергоёмкость шага' : null,
    conflictCount > 0 ? `Конфликтов: ${conflictCount}` : null,
  ].filter((item): item is string => Boolean(item))

  const warnings = [
    riskScore > 70 ? 'Риск срыва высокий: окно манёвра сужается.' : null,
    debtCost > 65 ? 'Долг растёт быстрее прогресса.' : null,
    !goalState ? 'Оценка предварительная: мало данных чек-инов.' : null,
    socialInsight ? null : 'Оценка поддержки предварительная: мало данных Соцрадара.',
  ].filter((item): item is string => Boolean(item))

  const hasMission = Boolean(goal.activeMission || goal.missions?.some((item) => item.status === 'suggested' || item.status === 'accepted'))
  const actionTitle = goal.activeMission?.title ?? nextMissionTitle ?? 'Сделать 25 минутный фокус-блок'

  const status: GoalProfileStatus = goal.status === 'archived'
    ? 'archived'
    : goal.status === 'trashed'
      ? 'paused'
      : riskScore >= 75
        ? 'at_risk'
        : missionStatus(goal) === 'snoozed'
          ? 'paused'
          : 'active'

  const confidence = goalState && (goal.missionHistory?.length ?? 0) > 0 ? 'high' : goalState ? 'medium' : 'low'

  return {
    id: goal.id,
    title: goal.title,
    status,
    importance: baseImportance,
    horizonDays: horizon,
    successValue,
    failCost,
    timeCost,
    energyCost,
    debtCost,
    riskScore,
    linkageScore,
    conflictScore,
    supportScore,
    progressScore,
    momentumScore,
    inactionCost,
    nextBestActionId: goal.activeMission?.id,
    blockers,
    supporters: supporters.length > 0 ? supporters : ['Утренний фокус-слот'],
    dependencies,
    conflicts,
    warnings,
    diagnosis: {
      weakSpot: weakestMetricLabel ?? goalMetrics[0] ?? 'Фокус',
      why: diagnosisReason ?? 'Высокий шум среды и конфликт времени тормозят прогресс.',
      mainBlocker: blockers[0] ?? 'Не хватает устойчивого триггера запуска',
      mainSupport: supporters[0] ?? 'Внутренняя мотивация и режим',
      mainConflict: conflicts[0] ?? 'Жёстких конфликтов не обнаружено',
      confidence,
    },
    prognosis: {
      idle: {
        riskDelta: Math.max(3, Math.round(riskScore * 0.08)),
        debtDelta: Math.max(2, Math.round(debtCost * 0.07)),
        momentumDelta: -Math.max(6, Math.round((100 - momentumScore) * 0.12)),
        verdict: 'Окно действия сужается, цель начинает тухнуть.',
      },
      takeStep: {
        riskDelta: -Math.max(3, Math.round(riskScore * 0.06)),
        debtDelta: -Math.max(2, Math.round(debtCost * 0.05)),
        momentumDelta: Math.max(8, Math.round((100 - momentumScore) * 0.16)),
        verdict: hasMission ? 'Шанс стабилизации выше, импульс возвращается.' : 'Даже базовый шаг снизит турбулентность.',
      },
      delay3d: {
        riskDelta: Math.max(4, Math.round(riskScore * 0.05)),
        debtDelta: Math.max(4, Math.round(debtCost * 0.08)),
        momentumDelta: -Math.max(7, Math.round((100 - momentumScore) * 0.1)),
        verdict: 'Компромисс допустим, но цена откладывания ускоряется.',
      },
    },
    decision: {
      actionTitle,
      whyBest: 'Шаг снимает главный блокер и двигает критичную зависимость без смены вкладки.',
      effect: `Импульс ${hasMission ? '+14' : '+10'}, риск ${hasMission ? '-5' : '-3'}, долг ${hasMission ? '-4' : '-2'}`,
      timeCostLabel: `${goal.activeMission?.timeBandMinutes ?? 35} минут`,
      energyCostLabel: energyLabel(energyCost),
      sideEffect: 'Временно придётся сдвинуть второстепенную рутину.',
    },
    constraints: [
      timeCost > 65 ? 'Нехватка времени под критичный блок.' : 'Время под контролем, но требует дисциплины.',
      conflictCount > 0 ? 'Конфликт с другой целью за слот и энергию.' : 'Явных межцелевых конфликтов пока мало.',
      supportScore < 40 ? 'Слабая внешняя опора и подтверждение.' : 'Опора есть, но держится на рутине.',
      confidence === 'low' ? 'Мало данных для уверенной диагностики.' : null,
    ].filter((item): item is string => Boolean(item)),
    branches: goalMetrics.slice(0, 5).map((name, index) => ({
      name,
      role: index === 0 ? 'риск' : index === 1 ? 'поддержка' : 'зависимость',
      strength: index === 0 ? 'сильная' : index <= 2 ? 'средняя' : 'слабая',
    })),
    preliminary: !goalState,
  }
}

export function profilePriority(profile: GoalProfile): number {
  return Number((0.3 * profile.importance
    + 0.2 * profile.inactionCost
    + 0.15 * profile.successValue
    + 0.15 * profile.linkageScore
    + 0.1 * profile.supportScore
    - 0.1 * profile.conflictScore).toFixed(2))
}
