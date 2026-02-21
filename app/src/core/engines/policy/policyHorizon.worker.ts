/// <reference lib="webworker" />

import { runBlackSwan } from '../blackSwan'
import type { BlackSwanInput } from '../blackSwan/types'
import { defaultInfluenceMatrix } from '../influence/influence'
import { summarizeTail } from '../multiverse/scoring'
import { buildActionLibrary, modeBudgetRisk, type PolicyActionEvaluation, type PolicyConstraints, type PolicyMode, type PolicyStateVector } from './index'
import { penaltyScore } from '../../actions/costModel'
import type { ActionBudgetEnvelope, ActionContext, ActionCostWeights, ActionState } from '../../actions/types'
import type { CheckinRecord } from '../../models/checkin'

import type { HorizonCandidateResult, PolicyHorizon, PolicyHorizonWorkerInput, PolicyHorizonWorkerOutput } from './policyHorizon.types'

const HORIZONS = [3, 7] as const

const MODE_WEIGHTS: Record<PolicyMode, { goal: number; index: number; risk: number; debt: number; tail: number; siren: number }> = {
  risk: { goal: 0.6, index: 0.8, risk: 3.2, debt: 1.2, tail: 2.4, siren: 3.4 },
  balanced: { goal: 1.3, index: 1.4, risk: 2.2, debt: 0.8, tail: 1.7, siren: 2.2 },
  growth: { goal: 2.1, index: 2.2, risk: 1.4, debt: 0.6, tail: 1.2, siren: 1.7 },
}

const COST_WEIGHTS: Record<PolicyMode, ActionCostWeights> = {
  risk: { timeMin: 0.01, energy: 0.04, money: 0.001, timeDebt: 2.5, risk: 6.5, entropy: 1.8 },
  balanced: { timeMin: 0.02, energy: 0.05, money: 0.0012, timeDebt: 1.8, risk: 4.2, entropy: 1.4 },
  growth: { timeMin: 0.015, energy: 0.03, money: 0.0008, timeDebt: 1.2, risk: 2.4, entropy: 0.8 },
}

function toActionState(state: PolicyStateVector): ActionState {
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

function quantile(values: number[], q: number): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

function toCheckin(state: ActionState): CheckinRecord {
  const stability = Math.max(0, Math.min(1, 1 - state.pCollapse))
  return {
    ts: 0,
    energy: Number((3 + state.index * 0.5 * stability).toFixed(2)),
    focus: Number((3 + state.index * 0.5).toFixed(2)),
    mood: Number((3 + state.index * 0.45 - state.sirenLevel).toFixed(2)),
    stress: Number((2 + state.sirenLevel * 6 + state.pCollapse * 2).toFixed(2)),
    sleepHours: Number((5 + stability * 3).toFixed(2)),
    social: Number((3 + stability * 3).toFixed(2)),
    productivity: Number((3 + state.index * 0.55).toFixed(2)),
    health: Number((3 + state.index * 0.4 - state.entropy * 2).toFixed(2)),
    cashFlow: Number((state.index * 180 + (1 - state.pCollapse) * 300).toFixed(2)),
  }
}

function isWithinConstraints(evaluation: PolicyActionEvaluation, constraints: PolicyConstraints): boolean {
  if (evaluation.deltas.pCollapse > constraints.maxPCollapse) return false
  if (evaluation.deltas.sirenRisk > constraints.sirenCap) return false
  if (evaluation.deltas.debt > constraints.maxDebtGrowth) return false
  return true
}

function scoreRollout(mode: PolicyMode, deltas: PolicyActionEvaluation['deltas'], state: ActionState): number {
  const w = MODE_WEIGHTS[mode]
  const lossFactor = (value: number): number => (value > 0 ? value * 1.75 : value)
  const collapseLoss = lossFactor(deltas.pCollapse)
  const sirenLoss = lossFactor(deltas.sirenRisk)
  const tailLoss = lossFactor(deltas.tailRisk)

  const reward = deltas.goalScore * w.goal + deltas.index * w.index
  const penalties = collapseLoss * w.risk * 100 + sirenLoss * w.siren * 80 + tailLoss * w.tail * 100 + deltas.debt * w.debt
  const stressPenalty = state.pCollapse > 0.35 ? Math.max(0, deltas.pCollapse) * 90 : 0
  return reward - penalties - stressPenalty
}

function budgetFor(state: ActionState, tuning: { load: number; cautious: number }): ActionBudgetEnvelope {
  return {
    maxTimeMin: Number((90 * (1 - tuning.load * 0.2)).toFixed(2)),
    maxEnergy: Number((35 * (1 - tuning.load * 0.2)).toFixed(2)),
    maxMoney: 5000,
    maxTimeDebt: 0.25,
    maxRisk: Number((modeBudgetRisk(state.sirenLevel) * (1 - tuning.cautious * 0.25)).toFixed(4)),
    maxEntropy: 0.2,
  }
}

function evaluateTailSignal(baseState: ActionState, horizon: PolicyHorizon, seed: number): number {
  const synthetic = toCheckin(baseState)
  const blackSwan = runBlackSwan({
    baseRecord: synthetic,
    history: [synthetic],
    matrix: defaultInfluenceMatrix,
    seed,
    settings: {
      horizonDays: horizon,
      simulations: 6,
      noiseMultiplier: 0.6,
      thresholdCollapse: 0.35,
      alpha: 0.1,
      weightsSource: 'manual',
      mix: 0,
      targetRedProb: 0.1,
    } as unknown as BlackSwanInput['settings'],
  })

  const quickPaths = [
    Array.from({ length: horizon }, (_, i) => ({ day: i + 1, index: Number((baseState.index - i * 0.03).toFixed(4)), pCollapse: Number(Math.min(1, baseState.pCollapse + i * 0.01).toFixed(4)), siren: baseState.pCollapse > 0.35 ? 'red' as const : 'amber' as const, regimeId: 0 as const })),
    Array.from({ length: horizon }, (_, i) => ({ day: i + 1, index: Number((baseState.index + i * 0.02).toFixed(4)), pCollapse: Number(Math.max(0, baseState.pCollapse - i * 0.005).toFixed(4)), siren: baseState.pCollapse > 0.2 ? 'amber' as const : 'green' as const, regimeId: 0 as const })),
  ]

  const multiverseTail = summarizeTail(quickPaths, 40, baseState.index, baseState.pCollapse)
  return Number(((blackSwan.tail.esCollapse + multiverseTail.cvar5Collapse) / 2).toFixed(4))
}

function runActionRollout(paramsInput: {
  state: ActionState
  mode: PolicyMode
  action: ReturnType<typeof buildActionLibrary>[number]
  seed: number
  horizon: PolicyHorizon
  constraints: PolicyConstraints
  tuning: { load: number; cautious: number }
}): HorizonCandidateResult | null {
  const { state, mode, action, seed, horizon, constraints } = paramsInput
  const ctx: ActionContext = { seed, mode }
  if (!action.preconditions(state, ctx)) return null
  if (mode === 'risk' && action.tags.includes('shock')) return null
  if (mode === 'growth' && action.tags.includes('shock') && !(state.sirenLevel <= 0.2 && state.shockBudget > 0 && state.recoveryScore >= constraints.minRecoveryScore)) return null

  let cur = { ...state }
  const gamma = 0.92
  const discountedScores: number[] = []
  let fail = 0
  const loadMultiplier = 1 + paramsInput.tuning.load * 0.5
  const cautiousMultiplier = 1 + paramsInput.tuning.cautious * 0.7
  const tunedWeights: ActionCostWeights = {
    ...COST_WEIGHTS[mode],
    timeMin: Number((COST_WEIGHTS[mode].timeMin * loadMultiplier).toFixed(4)),
    energy: Number((COST_WEIGHTS[mode].energy * loadMultiplier).toFixed(4)),
    risk: Number((COST_WEIGHTS[mode].risk * cautiousMultiplier).toFixed(4)),
    timeDebt: Number((COST_WEIGHTS[mode].timeDebt * cautiousMultiplier).toFixed(4)),
  }
  const penalty = penaltyScore(action.defaultCost, tunedWeights, budgetFor(cur, paramsInput.tuning))

  for (let day = 0; day < horizon; day += 1) {
    const stepDeltas = action.effectsFn(cur, ctx)
    const evaluation: PolicyActionEvaluation = { action, score: 0, penalty, deltas: stepDeltas, reasonsRu: [] }
    if (!isWithinConstraints(evaluation, constraints)) fail += 1

    cur = {
      ...cur,
      index: Number((cur.index + stepDeltas.index).toFixed(4)),
      pCollapse: Number(Math.max(0, Math.min(1, cur.pCollapse + stepDeltas.pCollapse)).toFixed(4)),
      sirenLevel: Number(Math.max(0, Math.min(1, cur.sirenLevel + stepDeltas.sirenRisk)).toFixed(4)),
      debtTotal: Number(Math.max(0, cur.debtTotal + stepDeltas.debt).toFixed(4)),
      goalGap: Number(Math.max(0, cur.goalGap - stepDeltas.goalScore).toFixed(4)),
      entropy: Number(Math.max(0, cur.entropy + action.defaultCost.entropy * 0.1).toFixed(4)),
      recoveryScore: Number((cur.recoveryScore + stepDeltas.goalScore * 0.5).toFixed(4)),
      shockBudget: Number(Math.max(0, cur.shockBudget - (action.tags.includes('shock') ? 0.1 : 0)).toFixed(4)),
    }

    const discounted = scoreRollout(mode, stepDeltas, cur) * Math.pow(gamma, day) - penalty
    discountedScores.push(Number(discounted.toFixed(4)))
  }

  const tail = evaluateTailSignal(cur, horizon, seed + horizon)
  const mean = discountedScores.reduce((sum, x) => sum + x, 0) / Math.max(1, discountedScores.length)
  const score = Number((mean - tail * 100).toFixed(4))

  return {
    actionId: action.id,
    mode,
    score,
    penalty: Number(penalty.toFixed(4)),
    horizon,
    summary: {
      mean: Number(mean.toFixed(4)),
      p10: Number(quantile(discountedScores, 0.1).toFixed(4)),
      p50: Number(quantile(discountedScores, 0.5).toFixed(4)),
      p90: Number(quantile(discountedScores, 0.9).toFixed(4)),
      tail,
      failRate: Number((fail / horizon).toFixed(4)),
    },
  }
}

export function evaluatePolicyHorizonInWorker(input: PolicyHorizonWorkerInput): PolicyHorizonWorkerOutput {
  const actions = buildActionLibrary()
  const modes: PolicyMode[] = ['risk', 'balanced', 'growth']
  const initial = toActionState(input.state)
  const byHorizon = {
    3: { risk: [], balanced: [], growth: [] },
    7: { risk: [], balanced: [], growth: [] },
  } as PolicyHorizonWorkerOutput['byHorizon']

  for (const horizon of HORIZONS) {
    for (const mode of modes) {
      const evaluated = actions
        .map((action, idx) => runActionRollout({
          state: initial,
          mode,
          action,
          seed: input.seed + idx * 97 + horizon * 31,
          horizon,
          constraints: input.constraints,
          tuning: input.tuning,
        }))
        .filter((item): item is HorizonCandidateResult => Boolean(item))
        .sort((a, b) => b.score - a.score || a.actionId.localeCompare(b.actionId))
        .slice(0, input.topK)
      byHorizon[horizon][mode] = evaluated
    }
  }

  const bestByPolicy = {
    risk: {
      3: byHorizon[3].risk[0],
      7: byHorizon[7].risk[0],
    },
    balanced: {
      3: byHorizon[3].balanced[0],
      7: byHorizon[7].balanced[0],
    },
    growth: {
      3: byHorizon[3].growth[0],
      7: byHorizon[7].growth[0],
    },
  } as PolicyHorizonWorkerOutput['bestByPolicy']

  return { byHorizon, bestByPolicy }
}

if (typeof self !== 'undefined') {
  self.onmessage = (event: MessageEvent<{ type: 'run'; input: PolicyHorizonWorkerInput }>) => {
    if (event.data.type !== 'run') return
    try {
      const result = evaluatePolicyHorizonInWorker(event.data.input)
      self.postMessage({ type: 'done', result })
    } catch (error) {
      self.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Ошибка horizon-расчёта' })
    }
  }
}

export {}
