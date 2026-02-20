import { computeIndexDay, computeVolatility } from '../analytics/compute'
import { assessCollapseRisk } from '../../collapse/model'
import { evaluateGoalScore, suggestGoalActions, type GoalActionSuggestion } from '../goal'
import { computeTopLevers } from '../influence/influence'
import type { InfluenceMatrix, MetricVector, WeightsSource } from '../influence/types'
import type { GoalRecord } from '../../models/goal'
import type { CheckinRecord } from '../../models/checkin'
import type { RegimeSnapshotRecord } from '../../models/regime'
import type { StateSnapshotRecord } from '../../models/state'
import type { TimeDebtSnapshotRecord } from '../../models/timeDebt'
import type { BlackSwanRunRecord } from '../../../repo/blackSwanRepo'
import { METRICS, type MetricId } from '../../metrics'

export type PolicyMode = 'risk' | 'balanced' | 'growth'

export interface PolicyConstraints {
  maxPCollapse: number
  sirenCap: number
  maxDebtGrowth: number
}

export interface PolicyAction {
  id: string
  titleRu: string
  type: 'goal' | 'siren' | 'graph' | 'debt'
  parameters: { delta: number; lag: number; horizon: number; metricId?: MetricId }
  tags: Array<'recovery' | 'goal' | 'risk'>
}

export interface PolicyStateVector {
  index: number
  pCollapse: number
  sirenLevel: number
  regimeId: number
  regimeProbs: number[]
  volatility: number
  entropy: number
  drift: number
  debtTotal: number
  goalScore: number
  goalGap: number
  tailRisk: { cvar: number; expectedShortfall: number; source: 'black-swan' | 'proxy' }
}

export interface PolicyActionEvaluation {
  action: PolicyAction
  score: number
  deltas: {
    goalScore: number
    index: number
    pCollapse: number
    tailRisk: number
    debt: number
    sirenRisk: number
  }
  reasonsRu: string[]
}

export interface PolicyResult {
  mode: PolicyMode
  nameRu: string
  ranked: PolicyActionEvaluation[]
  best: PolicyActionEvaluation
}

export interface PolicyAudit {
  weightsSource: WeightsSource
  mix: number
  tailRiskRunTs?: number
  forecastConfidence: 'низкая' | 'средняя' | 'высокая'
}

const MODE_WEIGHTS: Record<PolicyMode, { goal: number; index: number; risk: number; debt: number; tail: number; siren: number }> = {
  risk: { goal: 0.6, index: 0.8, risk: 3.2, debt: 1.2, tail: 2.4, siren: 3.4 },
  balanced: { goal: 1.3, index: 1.4, risk: 2.2, debt: 0.8, tail: 1.7, siren: 2.2 },
  growth: { goal: 2.1, index: 2.2, risk: 1.4, debt: 0.6, tail: 1.2, siren: 1.7 },
}

const MODE_RU: Record<PolicyMode, string> = {
  risk: 'Осторожный',
  balanced: 'Сбалансированный',
  growth: 'Разгон',
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function toMetricVector(checkin: CheckinRecord): MetricVector {
  return METRICS.reduce((acc, metric) => {
    acc[metric.id] = checkin[metric.id]
    return acc
  }, {} as MetricVector)
}

function mapSiren(level: 'green' | 'amber' | 'red'): number {
  if (level === 'red') return 1
  if (level === 'amber') return 0.6
  return 0.2
}

function label(metricId?: MetricId): string {
  if (!metricId) return 'рычаг'
  return METRICS.find((m) => m.id === metricId)?.labelRu ?? metricId
}

export function buildStateVector(params: {
  latestCheckin: CheckinRecord
  checkins: CheckinRecord[]
  stateSnapshot?: StateSnapshotRecord
  regimeSnapshot?: RegimeSnapshotRecord
  timeDebtSnapshot?: TimeDebtSnapshotRecord
  activeGoal: GoalRecord | null
  blackSwanRun?: BlackSwanRunRecord
}): PolicyStateVector {
  const { latestCheckin, checkins, stateSnapshot, regimeSnapshot, timeDebtSnapshot, activeGoal, blackSwanRun } = params
  const metrics = toMetricVector(latestCheckin)
  const index = stateSnapshot?.index ?? computeIndexDay(latestCheckin)
  const volatility = stateSnapshot?.volatility ?? computeVolatility(checkins, 'energy', 14)
  const collapse = assessCollapseRisk({
    ts: latestCheckin.ts,
    index,
    risk: Math.max(0, 10 - index),
    volatility,
    xp: stateSnapshot?.xp ?? 0,
    level: stateSnapshot?.level ?? 0,
    entropy: stateSnapshot?.entropy ?? 0,
    drift: stateSnapshot?.drift ?? 0,
    stats: stateSnapshot?.stats ?? { strength: latestCheckin.health * 10, intelligence: latestCheckin.focus * 10, wisdom: latestCheckin.mood * 10, dexterity: latestCheckin.energy * 10 },
  }, latestCheckin)

  const goalScore = activeGoal
    ? evaluateGoalScore(activeGoal, {
      index,
      pCollapse: regimeSnapshot?.pCollapse ?? collapse.pCollapse,
      entropy: stateSnapshot?.entropy ?? 0,
      drift: stateSnapshot?.drift ?? 0,
      stats: stateSnapshot?.stats ?? { strength: latestCheckin.health * 10, intelligence: latestCheckin.focus * 10, wisdom: latestCheckin.mood * 10, dexterity: latestCheckin.energy * 10 },
      metrics,
    })
    : { goalScore: 50, goalGap: 0 }

  const tailFromBlackSwan = blackSwanRun
    ? {
      cvar: clamp01(blackSwanRun.summary.esCollapse10),
      expectedShortfall: clamp01(blackSwanRun.summary.esCollapse10),
      source: 'black-swan' as const,
    }
    : {
      cvar: clamp01((regimeSnapshot?.pCollapse ?? collapse.pCollapse) + (regimeSnapshot?.sirenLevel === 'red' ? 0.25 : regimeSnapshot?.sirenLevel === 'amber' ? 0.12 : 0.04)),
      expectedShortfall: clamp01((regimeSnapshot?.pCollapse ?? collapse.pCollapse) + Math.max(0, volatility - 1) * 0.1),
      source: 'proxy' as const,
    }

  return {
    index,
    pCollapse: regimeSnapshot?.pCollapse ?? collapse.pCollapse,
    sirenLevel: mapSiren(regimeSnapshot?.sirenLevel ?? collapse.sirenLevel),
    regimeId: regimeSnapshot?.regimeId ?? 0,
    regimeProbs: regimeSnapshot?.regimeProbs ?? [],
    volatility,
    entropy: stateSnapshot?.entropy ?? 0,
    drift: stateSnapshot?.drift ?? 0,
    debtTotal: timeDebtSnapshot?.totals.totalDebt ?? 0,
    goalScore: goalScore.goalScore,
    goalGap: goalScore.goalGap,
    tailRisk: tailFromBlackSwan,
  }
}

function fromGoalActions(actions: GoalActionSuggestion[]): PolicyAction[] {
  return actions.map((a) => ({
    id: `goal:${a.metricId}:${a.impulse}`,
    titleRu: a.titleRu,
    type: 'goal' as const,
    parameters: { delta: a.impulse, lag: 1, horizon: 3, metricId: a.metricId },
    tags: ['goal', a.deltaPCollapse < 0 ? 'risk' : 'recovery'],
  }))
}

export function buildActionLibrary(params: {
  latestCheckin: CheckinRecord
  baseVector: MetricVector
  matrix: InfluenceMatrix
  activeGoal: GoalRecord | null
  regimeSnapshot?: RegimeSnapshotRecord
  debtSnapshot?: TimeDebtSnapshotRecord
}): PolicyAction[] {
  const { latestCheckin, baseVector, matrix, activeGoal, regimeSnapshot, debtSnapshot } = params
  const actions: PolicyAction[] = []

  if (activeGoal) {
    const goalActions = suggestGoalActions(activeGoal, {
      index: computeIndexDay(latestCheckin),
      pCollapse: regimeSnapshot?.pCollapse ?? 0.2,
      entropy: 0,
      drift: 0,
      stats: { strength: latestCheckin.health * 10, intelligence: latestCheckin.focus * 10, wisdom: latestCheckin.mood * 10, dexterity: latestCheckin.energy * 10 },
      metrics: baseVector,
    }, matrix)
    actions.push(...fromGoalActions(goalActions))
  }

  if ((regimeSnapshot?.sirenLevel ?? 'green') !== 'green') {
    actions.push(
      {
        id: 'siren:discharge',
        titleRu: 'Разрядка нагрузки: убрать интенсивные задачи на сегодня',
        type: 'siren' as const,
        parameters: { delta: -1, lag: 0, horizon: 2 },
        tags: ['risk', 'recovery'],
      },
      {
        id: 'siren:sleep',
        titleRu: 'Стабилизировать сон и закрыть день раньше',
        type: 'siren' as const,
        parameters: { delta: -1, lag: 0, horizon: 2 },
        tags: ['risk', 'recovery'],
      },
    )
  }

  const levers = computeTopLevers(baseVector, matrix, 3)
  actions.push(...levers.map((lever) => ({
    id: `graph:${lever.from}:${lever.to}`,
    titleRu: `Рычаг ${label(lever.from)} → ${label(lever.to)}`,
    type: 'graph' as const,
    parameters: { delta: lever.suggestedDelta, lag: 1, horizon: 3, metricId: lever.from },
    tags: ['goal'] as Array<'goal'>,
  })))

  const debtTop = debtSnapshot?.protocolActions.slice(0, 2) ?? []
  actions.push(...debtTop.map((item) => ({
    id: `debt:${item.actionId}`,
    titleRu: item.titleRu,
    type: 'debt' as const,
    parameters: { delta: 1, lag: 0, horizon: 3 },
    tags: ['recovery', 'risk'] as Array<'recovery' | 'risk'>,
  })))

  return actions.filter((item, idx, arr) => arr.findIndex((v) => v.id === item.id) === idx)
}

function estimateActionDelta(action: PolicyAction, base: PolicyStateVector): PolicyActionEvaluation['deltas'] {
  const baseSign = action.type === 'siren' || action.type === 'debt' ? -1 : 1
  const gain = action.type === 'graph' ? 0.35 : action.type === 'goal' ? 0.28 : 0.18
  const index = Number((baseSign * gain * action.parameters.delta).toFixed(3))
  const pCollapse = Number(((-baseSign * gain * 0.08 * action.parameters.delta) + (action.type === 'graph' && base.sirenLevel > 0.6 ? 0.012 : 0)).toFixed(4))
  const goalScore = Number((index * 8 - pCollapse * 50).toFixed(2))
  const debt = Number(((action.type === 'debt' ? -0.45 : action.type === 'siren' ? -0.2 : 0.15) * Math.abs(action.parameters.delta)).toFixed(3))
  const tailRisk = Number((pCollapse * 1.1 + (action.type === 'graph' ? 0.01 : -0.005)).toFixed(4))
  const sirenRisk = Number((pCollapse * 1.5 + (action.type === 'siren' ? -0.04 : 0.01)).toFixed(4))
  return { goalScore, index, pCollapse, tailRisk, debt, sirenRisk }
}

function scoreAction(params: { mode: PolicyMode; deltas: PolicyActionEvaluation['deltas']; state: PolicyStateVector }): number {
  const { mode, deltas, state } = params
  const w = MODE_WEIGHTS[mode]
  const lossFactor = (value: number): number => (value > 0 ? value * 1.75 : value)
  const collapseLoss = lossFactor(deltas.pCollapse)
  const sirenLoss = lossFactor(deltas.sirenRisk)
  const tailLoss = lossFactor(deltas.tailRisk)

  const reward = deltas.goalScore * w.goal + deltas.index * w.index
  const penalties = collapseLoss * w.risk * 100 + sirenLoss * w.siren * 80 + tailLoss * w.tail * 100 + deltas.debt * w.debt
  const stressPenalty = state.pCollapse > 0.35 ? Math.max(0, deltas.pCollapse) * 90 : 0

  return Number((reward - penalties - stressPenalty).toFixed(3))
}

function reasons(action: PolicyAction, deltas: PolicyActionEvaluation['deltas'], mode: PolicyMode): string[] {
  const reasonsList = [
    `Влияние на индекс: ${deltas.index >= 0 ? '+' : ''}${deltas.index.toFixed(2)}.`,
    `Эффект на P(collapse): ${deltas.pCollapse >= 0 ? '+' : ''}${(deltas.pCollapse * 100).toFixed(2)} п.п.`,
    `Баланс цели и долга в режиме «${MODE_RU[mode]}».`,
  ]
  if (action.type === 'siren') reasonsList[2] = 'Приоритет — снять нагрузку Сирены до безопасного уровня.'
  if (action.type === 'debt') reasonsList[2] = 'Сокращает долг и поддерживает устойчивость на горизонте 3 дней.'
  return reasonsList
}

function withinConstraints(evaluation: PolicyActionEvaluation, constraints: PolicyConstraints): boolean {
  if (evaluation.deltas.pCollapse > constraints.maxPCollapse) return false
  if (evaluation.deltas.sirenRisk > constraints.sirenCap) return false
  if (evaluation.deltas.debt > constraints.maxDebtGrowth) return false
  return true
}

export function evaluatePolicies(params: {
  state: PolicyStateVector
  actions: PolicyAction[]
  constraints: PolicyConstraints
}): PolicyResult[] {
  const { state, actions, constraints } = params
  const modes: PolicyMode[] = ['risk', 'balanced', 'growth']
  return modes.map((mode) => {
    const evaluated = actions.map((action) => {
      const deltas = estimateActionDelta(action, state)
      const score = scoreAction({ mode, deltas, state })
      return {
        action,
        deltas,
        score,
        reasonsRu: reasons(action, deltas, mode),
      }
    })
      .filter((item) => (mode === 'risk' ? withinConstraints(item, constraints) : true))
      .sort((a, b) => b.score - a.score || a.action.id.localeCompare(b.action.id))
      .slice(0, 3)

    const fallback = evaluated[0] ?? {
      action: {
        id: `${mode}:hold`,
        titleRu: 'Зафиксировать режим и наблюдать сутки',
        type: 'risk' === mode ? 'siren' : 'debt',
        parameters: { delta: 0, lag: 1, horizon: 1 },
        tags: ['risk'],
      } as PolicyAction,
      deltas: { goalScore: 0, index: 0, pCollapse: 0, tailRisk: 0, debt: 0, sirenRisk: 0 },
      score: 0,
      reasonsRu: ['Действия не прошли ограничения.', 'Снизьте жёсткость лимитов.', 'Пересчёт доступен после обновления состояния.'],
    }

    return {
      mode,
      nameRu: MODE_RU[mode],
      ranked: evaluated,
      best: fallback,
    }
  })
}
