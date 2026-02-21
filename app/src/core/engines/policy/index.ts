import { computeIndexDay, computeVolatility } from '../analytics/compute'
import { assessCollapseRisk } from '../../collapse/model'
import { evaluateGoalScore } from '../goal'
import type { MetricVector, WeightsSource } from '../influence/types'
import type { GoalRecord } from '../../models/goal'
import type { CheckinRecord } from '../../models/checkin'
import type { RegimeSnapshotRecord } from '../../models/regime'
import type { StateSnapshotRecord } from '../../models/state'
import type { TimeDebtSnapshotRecord } from '../../models/timeDebt'
import type { BlackSwanRunRecord } from '../../../repo/blackSwanRepo'
import { METRICS } from '../../metrics'
import { buildCatalogHash, buildStateHash, buildWhyTopRu } from '../../actions/audit'
import { buildUnifiedActionCatalog } from '../../actions/catalog'
import { penaltyScore } from '../../actions/costModel'
import type { ActionBudgetEnvelope, ActionContext, ActionCostWeights } from '../../actions/types'
import { saveActionAudit } from '../../../repo/actionAuditRepo'
import { evaluateModelHealth } from '../analytics/modelHealth'
import type { HorizonCandidateResult, HorizonSummaryCompact, PolicyHorizonWorkerInput, PolicyHorizonWorkerOutput } from './policyHorizon.types'

export type PolicyMode = 'risk' | 'balanced' | 'growth'

export interface PolicyConstraints {
  maxPCollapse: number
  sirenCap: number
  maxDebtGrowth: number
  minRecoveryScore: number
}

export interface PolicyAction {
  id: string
  titleRu: string
  type: 'goal' | 'siren' | 'graph' | 'debt' | 'shock'
  parameters: { delta: number; lag: number; horizon: number }
  tags: Array<'recovery' | 'goal' | 'risk' | 'shock'>
  defaultCost: { timeMin: number; energy: number; money: number; timeDebt: number; risk: number; entropy: number }
  domain: 'здоровье' | 'фокус' | 'карьера' | 'финансы' | 'социальное' | 'восстановление'
  preconditions: (state: import('../../actions/types').ActionState, ctx: ActionContext) => boolean
  effectsFn: (state: import('../../actions/types').ActionState, ctx: ActionContext) => PolicyActionEvaluation['deltas']
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
  recoveryScore: number
  shockBudget: number
}

export interface PolicyActionEvaluation {
  action: PolicyAction
  score: number
  penalty?: number
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

export interface PolicyTuning {
  load: number
  cautious: number
}

export interface HonestyGateDecision {
  safeMode: boolean
  driftDetected: boolean
  gatesApplied: string[]
  reasonsRu: string[]
  fallbackPolicy: PolicyMode
}

export interface PolicyHorizonResult {
  byHorizon: PolicyHorizonWorkerOutput['byHorizon']
  bestByPolicy: PolicyHorizonWorkerOutput['bestByPolicy']
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

export function buildStateVector(params: {
  latestCheckin: CheckinRecord
  checkins: CheckinRecord[]
  stateSnapshot?: StateSnapshotRecord
  regimeSnapshot?: RegimeSnapshotRecord
  timeDebtSnapshot?: TimeDebtSnapshotRecord
  activeGoal: GoalRecord | null
  blackSwanRun?: BlackSwanRunRecord
  recoveryScore?: number
  shockBudget?: number
}): PolicyStateVector {
  const { latestCheckin, checkins, stateSnapshot, regimeSnapshot, timeDebtSnapshot, activeGoal, blackSwanRun, recoveryScore, shockBudget } = params
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
    recoveryScore: recoveryScore ?? 0,
    shockBudget: shockBudget ?? 0,
  }
}


function toActionState(state: PolicyStateVector): import('../../actions/types').ActionState {
  return {
    index: state.index,
    pCollapse: state.pCollapse,
    sirenLevel: state.sirenLevel,
    debtTotal: state.debtTotal,
    goalGap: state.goalGap,
    recoveryScore: state.recoveryScore,
    shockBudget: state.shockBudget,
    entropy: state.entropy,
  }
}

export function buildActionLibrary(): PolicyAction[] {
  return buildUnifiedActionCatalog().map((item) => ({
    id: item.id,
    titleRu: item.titleRu,
    type: item.tags.includes('shock') ? 'shock' : item.tags.includes('risk') ? 'siren' : 'goal',
    parameters: { delta: 1, lag: 0, horizon: 1 },
    tags: [...item.tags],
    defaultCost: item.defaultCost,
    domain: item.domain,
    preconditions: item.preconditions,
    effectsFn: item.effectsFn,
  }))
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

function scoreActionWithGuardrails(params: {
  mode: PolicyMode
  deltas: PolicyActionEvaluation['deltas']
  state: PolicyStateVector
  safeMode: boolean
}): number {
  const tailPenaltyMultiplier = params.safeMode ? 1.8 : 1
  const failPenaltyMultiplier = params.safeMode ? 1.6 : 1
  const adjusted = {
    ...params.deltas,
    tailRisk: Number((params.deltas.tailRisk * tailPenaltyMultiplier).toFixed(6)),
    sirenRisk: Number((params.deltas.sirenRisk * failPenaltyMultiplier).toFixed(6)),
  }
  return scoreAction({ mode: params.mode, deltas: adjusted, state: params.state })
}

function reasons(action: PolicyAction, deltas: PolicyActionEvaluation['deltas'], mode: PolicyMode): string[] {
  const reasonsList = [
    `Влияние на индекс: ${deltas.index >= 0 ? '+' : ''}${deltas.index.toFixed(2)}.`,
    `Эффект на P(collapse): ${deltas.pCollapse >= 0 ? '+' : ''}${(deltas.pCollapse * 100).toFixed(2)} п.п.`,
    `Баланс цели и долга в режиме «${MODE_RU[mode]}».`,
  ]
  if (action.type === 'siren') reasonsList[2] = 'Приоритет — снять нагрузку Сирены до безопасного уровня.'
  if (action.type === 'debt') reasonsList[2] = 'Сокращает долг и поддерживает устойчивость на горизонте 3 дней.'
  if (action.type === 'shock') reasonsList[2] = 'Контролируемая встряска допустима только в зелёном состоянии.'
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
  seed?: number
  tuning?: PolicyTuning
  safeMode?: boolean
}): PolicyResult[] {
  const { state, actions, constraints, seed = 0, safeMode = false } = params
  const tuning = params.tuning ?? { load: 0, cautious: 0 }
  const modes: PolicyMode[] = ['risk', 'balanced', 'growth']
  const baseState = toActionState(state)

  const loadMultiplier = 1 + tuning.load * 0.5
  const cautiousMultiplier = 1 + tuning.cautious * 0.7

  const costWeights: Record<PolicyMode, ActionCostWeights> = {
    risk: { timeMin: 0.01, energy: 0.04, money: 0.001, timeDebt: 2.5, risk: 6.5, entropy: 1.8 },
    balanced: { timeMin: 0.02, energy: 0.05, money: 0.0012, timeDebt: 1.8, risk: 4.2, entropy: 1.4 },
    growth: { timeMin: 0.015, energy: 0.03, money: 0.0008, timeDebt: 1.2, risk: 2.4, entropy: 0.8 },
  }

  const tunedCostWeights = (Object.keys(costWeights) as PolicyMode[]).reduce((acc, policyMode) => {
    const base = costWeights[policyMode]
    acc[policyMode] = {
      ...base,
      timeMin: Number((base.timeMin * loadMultiplier).toFixed(4)),
      energy: Number((base.energy * loadMultiplier).toFixed(4)),
      risk: Number((base.risk * cautiousMultiplier).toFixed(4)),
      timeDebt: Number((base.timeDebt * cautiousMultiplier).toFixed(4)),
    }
    return acc
  }, {} as Record<PolicyMode, ActionCostWeights>)

  const safeBudgetMultiplier = safeMode ? 0.72 : 1

  const budget: ActionBudgetEnvelope = {
    maxTimeMin: Number((90 * (1 - tuning.load * 0.2) * safeBudgetMultiplier).toFixed(2)),
    maxEnergy: Number((35 * (1 - tuning.load * 0.2) * safeBudgetMultiplier).toFixed(2)),
    maxMoney: 5000,
    maxTimeDebt: Number((0.25 * safeBudgetMultiplier).toFixed(4)),
    maxRisk: Number((modeBudgetRisk(state.sirenLevel) * (1 - tuning.cautious * 0.25) * safeBudgetMultiplier).toFixed(4)),
    maxEntropy: Number((0.2 * safeBudgetMultiplier).toFixed(4)),
  }

  const modeResults = modes.map((mode) => {
    const ctx: ActionContext = { seed, mode }
    const evaluated = actions
      .filter((action) => action.preconditions(baseState, ctx))
      .map((action) => {
        const deltas = action.effectsFn(baseState, ctx)
        const baseScore = scoreActionWithGuardrails({ mode, deltas, state, safeMode })
        const penalty = penaltyScore(action.defaultCost, tunedCostWeights[mode], budget)
        const score = Number((baseScore - penalty).toFixed(3))
        return {
          action,
          deltas,
          score,
          penalty,
          reasonsRu: reasons(action, deltas, mode),
        }
      })
      .filter((item) => withinConstraints(item, constraints))
      .filter((item) => (mode === 'risk' ? !item.action.tags.includes('shock') : true))
      .filter((item) => (safeMode ? !item.action.tags.includes('shock') : true))
      .filter((item) => (safeMode && mode !== 'risk' ? !item.action.tags.includes('risk') : true))
      .filter((item) => (mode === 'growth' && item.action.tags.includes('shock') ? (state.sirenLevel <= 0.2 && state.shockBudget > 0 && state.recoveryScore >= constraints.minRecoveryScore) : true))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score
        return a.action.id.localeCompare(b.action.id)
      })
      .slice(0, 5)

    const fallback = evaluated[0] ?? {
      action: {
        id: `${mode}:hold`,
        titleRu: 'Зафиксировать режим и наблюдать сутки',
        type: 'risk' === mode ? 'siren' : 'debt',
        parameters: { delta: 0, lag: 1, horizon: 1 },
        tags: ['risk'],
        defaultCost: { timeMin: 0, energy: 0, money: 0, timeDebt: 0, risk: 0, entropy: 0 },
        domain: 'восстановление',
        preconditions: () => true,
        effectsFn: () => ({ goalScore: 0, index: 0, pCollapse: 0, tailRisk: 0, debt: 0, sirenRisk: 0 }),
      } as PolicyAction,
      deltas: { goalScore: 0, index: 0, pCollapse: 0, tailRisk: 0, debt: 0, sirenRisk: 0 },
      score: 0,
      penalty: 0,
      reasonsRu: ['Действия не прошли ограничения.', 'Снизьте жёсткость лимитов.', 'Пересчёт доступен после обновления состояния.'],
    }

    return {
      mode,
      nameRu: MODE_RU[mode],
      ranked: evaluated,
      best: fallback,
    }
  })

  return modeResults
}

export function evaluateHonestyGates(params: {
  modelHealthGrade: 'green' | 'yellow' | 'red'
  driftDetected: boolean
  requestedMode: PolicyMode
}): HonestyGateDecision {
  const gatesApplied: string[] = []
  const reasonsRu: string[] = []

  if (params.modelHealthGrade === 'red') {
    gatesApplied.push('model-health-red')
    reasonsRu.push('Model Health в красной зоне — включён безопасный режим.')
  }
  if (params.driftDetected) {
    gatesApplied.push('drift-detected')
    reasonsRu.push('Обнаружен дрейф — включён безопасный режим до стабилизации.')
  }

  const safeMode = gatesApplied.length > 0
  if (safeMode) {
    gatesApplied.push('tight-budget')
    gatesApplied.push('tail-fail-penalty-up')
    gatesApplied.push('restrict-risky-paths')
  }

  return {
    safeMode,
    driftDetected: params.driftDetected,
    gatesApplied,
    reasonsRu,
    fallbackPolicy: safeMode ? 'risk' : params.requestedMode,
  }
}

export function modeBudgetRisk(sirenLevel: number): number {
  if (sirenLevel >= 1) return 0.03
  if (sirenLevel >= 0.6) return 0.05
  return 0.12
}

function createPolicyHorizonWorker(): Worker {
  return new Worker(new URL('./policyHorizon.worker.ts', import.meta.url), { type: 'module' })
}

export function evaluatePoliciesWithAuditHorizon(params: {
  state: PolicyStateVector
  constraints: PolicyConstraints
  seed: number
  topK?: number
  tuning?: PolicyTuning
}): Promise<PolicyHorizonResult> {
  return new Promise((resolve, reject) => {
    const worker = createPolicyHorizonWorker()
    worker.onmessage = (event: MessageEvent<{ type: 'done'; result: PolicyHorizonWorkerOutput } | { type: 'error'; message: string }>) => {
      if (event.data.type === 'error') {
        worker.terminate()
        reject(new Error(event.data.message))
        return
      }
      worker.terminate()
      resolve(event.data.result)
    }
    const input: PolicyHorizonWorkerInput = {
      state: params.state,
      constraints: params.constraints,
      seed: params.seed,
      topK: params.topK ?? 5,
      tuning: params.tuning ?? { load: 0, cautious: 0 },
    }
    worker.postMessage({ type: 'run', input })
  })
}

export async function evaluatePoliciesWithAudit(params: {
  state: PolicyStateVector
  constraints: PolicyConstraints
  mode: PolicyMode
  seed: number
  buildId: string
  policyVersion: string
  tuning?: PolicyTuning
}): Promise<PolicyResult[]> {
  const actions = buildActionLibrary()
  const stateHash = buildStateHash(toActionState(params.state))
  const catalogHash = buildCatalogHash(actions)
  const horizon = await evaluatePoliciesWithAuditHorizon({ state: params.state, constraints: params.constraints, seed: params.seed, topK: 5, tuning: params.tuning })
  const horizonSummary = (Object.keys(horizon.byHorizon) as Array<'3' | '7'>).flatMap((horizonKey) => {
    const horizonDays = Number(horizonKey) as 3 | 7
    const byMode = horizon.byHorizon[horizonDays]
    return (Object.entries(byMode) as Array<[PolicyMode, HorizonCandidateResult[]]>).flatMap(([policyMode, candidates]) =>
      candidates.slice(0, 3).map((candidate) => ({
        horizonDays,
        policyMode,
        actionId: candidate.actionId,
        stats: candidate.summary as HorizonSummaryCompact,
      })),
    )
  })

  const policyCalibration = horizonSummary.map((item) => ({
    probability: Math.max(0, Math.min(1, 1 - item.stats.failRate)),
    outcome: item.stats.failRate <= params.constraints.sirenCap ? 1 as const : 0 as const,
  }))
  const policyDriftSeries = horizonSummary.map((item) => Number(Math.abs(item.stats.p90 - item.stats.p10).toFixed(4)))
  const policyHealth = evaluateModelHealth({
    kind: 'policy',
    calibration: policyCalibration,
    driftSeries: policyDriftSeries,
    minSamples: 6,
  })
  const honestyGates = evaluateHonestyGates({
    modelHealthGrade: policyHealth.grade,
    driftDetected: policyHealth.drift.triggered,
    requestedMode: params.mode,
  })

  const gatedEvaluated = evaluatePolicies({
    state: params.state,
    actions,
    constraints: params.constraints,
    seed: params.seed,
    tuning: params.tuning,
    safeMode: honestyGates.safeMode,
  })
  const selected = gatedEvaluated.find((item) => item.mode === honestyGates.fallbackPolicy) ?? gatedEvaluated[0]
  const topCandidates = selected.ranked.slice(0, 5).map((item) => ({ actionId: item.action.id, score: item.score, penalty: Number(item.penalty ?? 0) }))

  if (selected) {
    await saveActionAudit({
      ts: Date.now(),
      chosenActionId: selected.best.action.id,
      stateHash,
      seed: params.seed,
      reproToken: {
        buildId: params.buildId,
        seed: params.seed,
        stateHash,
        catalogHash,
        policyVersion: params.policyVersion,
      },
      topCandidates,
      horizonSummary,
      whyTopRu: buildWhyTopRu([...honestyGates.reasonsRu, ...selected.best.reasonsRu]),
      modelHealth: policyHealth,
      safeMode: honestyGates.safeMode,
      gatesApplied: honestyGates.gatesApplied,
      gateReasonsRu: honestyGates.reasonsRu,
      fallbackPolicy: honestyGates.fallbackPolicy,
    })
  }

  return gatedEvaluated
}
