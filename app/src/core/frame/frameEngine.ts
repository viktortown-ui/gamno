import type { GoalRecord } from '../models/goal'
import type { QuestRecord } from '../models/quest'
import type { RegimeSnapshotRecord } from '../models/regime'
import type { StateSnapshotRecord } from '../models/state'
import type { AntifragilitySnapshotRecord } from '../models/antifragility'
import type { ForecastRunRecord } from '../../repo/forecastRepo'
import type { BlackSwanRunRecord } from '../../repo/blackSwanRepo'
import type { MultiverseRunRecord } from '../../repo/multiverseRepo'
import type { TimeDebtSnapshotRecord } from '../models/timeDebt'
import type { PolicyRecord, PolicyRunRecord } from '../../repo/policyRepo'
import { dayKeyFromTs } from '../utils/dayKey'
import type { TailRiskSummaryCompact } from '../risk/tailRisk'

export interface FrameSnapshot {
  ts: number
  dayKey: string
  baselineId?: number
  stateSnapshot: {
    index: number
    risk: number
    volatility: number
    entropy: number
    drift: number
    stats: StateSnapshotRecord['stats']
    xp: number
    level: number
  }
  regimeSnapshot: {
    regimeId: number
    next1?: number[]
    next3?: number[]
    pCollapse: number
    sirenLevel: 'green' | 'amber' | 'red'
    explainTop3: string[]
    disarmProtocol: string[]
  }
  goal: {
    active?: { id?: number; title: string }
    goalScore: number
    gap: number
    explainTop3: string[]
  }
  mission?: { id?: number; title: string; status: string }
  debt: {
    totalDebt: number
    trend: 'up' | 'down' | 'flat'
    protocol: string[]
  }
  antifragility: {
    recoveryScore: number
    shockBudget: number
    antifragilityScore: number
  }
  forecastSummary: {
    p50next7: number
    confidence: 'низкая' | 'средняя' | 'высокая'
    coverage: number
  }
  tailRiskSummary: {
    pRed7d: number
    esCollapse10?: number
    cvar?: number
    collapseTail?: TailRiskSummaryCompact
    runTs?: number
  }
  multiverseSummary: {
    branches: Array<{ nameRu: string; probability: number }>
    chosenBranch?: string
    runTs?: number
  }
  socialSummary: {
    topInfluencesWeek: string[]
  }
  autopilotSummary: {
    policy?: string
    nextAction?: string
  }
}

export interface FrameBuildInput {
  nowTs?: number
  baselineId?: number
  state?: StateSnapshotRecord
  regime?: RegimeSnapshotRecord
  goal?: GoalRecord
  goalScore?: number
  goalGap?: number
  goalExplainTop3?: string[]
  activeQuest?: QuestRecord
  debt?: TimeDebtSnapshotRecord
  antifragility?: AntifragilitySnapshotRecord
  forecast?: ForecastRunRecord
  blackSwan?: BlackSwanRunRecord
  multiverse?: MultiverseRunRecord
  socialTop3?: string[]
  activePolicy?: PolicyRecord
  lastPolicyRun?: PolicyRunRecord
}

export function buildFrameSnapshot(input: FrameBuildInput): FrameSnapshot {
  const ts = input.nowTs ?? [
    input.state?.ts,
    input.regime?.ts,
    input.debt?.ts,
    input.antifragility?.ts,
    input.forecast?.ts,
    input.blackSwan?.ts,
    input.multiverse?.ts,
  ].filter((item): item is number => typeof item === 'number').sort((a, b) => b - a)[0] ?? Date.now()

  const coverage = input.forecast?.backtest.coverage ?? 0
  const confidence: 'низкая' | 'средняя' | 'высокая' = coverage >= 75 ? 'высокая' : coverage >= 60 ? 'средняя' : 'низкая'

  return {
    ts,
    dayKey: dayKeyFromTs(ts),
    baselineId: input.baselineId,
    stateSnapshot: {
      index: input.state?.index ?? 0,
      risk: input.state?.risk ?? 0,
      volatility: input.state?.volatility ?? 0,
      entropy: input.state?.entropy ?? 0,
      drift: input.state?.drift ?? 0,
      stats: input.state?.stats ?? { strength: 0, intelligence: 0, wisdom: 0, dexterity: 0 },
      xp: input.state?.xp ?? 0,
      level: input.state?.level ?? 1,
    },
    regimeSnapshot: {
      regimeId: input.regime?.regimeId ?? 0,
      next1: input.regime?.next1,
      next3: input.regime?.next3,
      pCollapse: input.regime?.pCollapse ?? 0,
      sirenLevel: input.regime?.sirenLevel ?? 'green',
      explainTop3: input.regime?.explainTop3 ?? [],
      disarmProtocol: input.regime?.explainTop3?.slice(0, 2) ?? [],
    },
    goal: {
      active: input.goal ? { id: input.goal.id, title: input.goal.title } : undefined,
      goalScore: input.goalScore ?? 0,
      gap: input.goalGap ?? 0,
      explainTop3: input.goalExplainTop3 ?? [],
    },
    mission: input.activeQuest ? { id: input.activeQuest.id, title: input.activeQuest.title, status: input.activeQuest.status } : undefined,
    debt: {
      totalDebt: input.debt?.totals.totalDebt ?? 0,
      trend: input.debt?.totals.debtTrend ?? 'flat',
      protocol: input.debt?.protocol ?? [],
    },
    antifragility: {
      recoveryScore: input.antifragility?.recoveryScore ?? 0,
      shockBudget: input.antifragility?.shockBudget ?? 0,
      antifragilityScore: input.antifragility?.antifragilityScore ?? 0,
    },
    forecastSummary: {
      p50next7: input.forecast?.index.p50[6] ?? input.forecast?.index.p50.at(-1) ?? 0,
      confidence,
      coverage,
    },
    tailRiskSummary: {
      pRed7d: input.blackSwan?.summary.pRed7d ?? 0,
      esCollapse10: input.blackSwan?.summary.esCollapse10,
      cvar: input.blackSwan?.payload.tail.esCollapse,
      collapseTail: input.blackSwan?.payload.tail.collapseTail
        ? {
          alpha: input.blackSwan.payload.tail.collapseTail.alpha,
          var: input.blackSwan.payload.tail.collapseTail.var,
          es: input.blackSwan.payload.tail.collapseTail.es,
          tailMass: input.blackSwan.payload.tail.collapseTail.tailMass,
          n: input.blackSwan.payload.tail.collapseTail.n,
          method: input.blackSwan.payload.tail.collapseTail.method,
          warnings: [...input.blackSwan.payload.tail.collapseTail.warnings],
        }
        : undefined,
      runTs: input.blackSwan?.ts,
    },
    multiverseSummary: {
      branches: (input.multiverse?.branches ?? []).slice(0, 3).map((item) => ({ nameRu: item.nameRu, probability: item.probability })),
      chosenBranch: input.multiverse?.branches?.slice().sort((a, b) => b.probability - a.probability)[0]?.nameRu,
      runTs: input.multiverse?.ts,
    },
    socialSummary: {
      topInfluencesWeek: input.socialTop3 ?? [],
    },
    autopilotSummary: {
      policy: input.activePolicy?.nameRu,
      nextAction: input.lastPolicyRun?.chosenActionId,
    },
  }
}

function diffItems(current: FrameSnapshot, previous?: FrameSnapshot): Array<{ key: string; value: number; text: string }> {
  if (!previous) return [{ key: 'first', value: 9999, text: 'Создан первый единый кадр системы.' }]
  const rows = [
    { key: 'index', value: Math.abs(current.stateSnapshot.index - previous.stateSnapshot.index), text: `Индекс: ${previous.stateSnapshot.index.toFixed(1)} → ${current.stateSnapshot.index.toFixed(1)}` },
    { key: 'collapse', value: Math.abs(current.regimeSnapshot.pCollapse - previous.regimeSnapshot.pCollapse), text: `P(collapse): ${(previous.regimeSnapshot.pCollapse * 100).toFixed(1)}% → ${(current.regimeSnapshot.pCollapse * 100).toFixed(1)}%` },
    { key: 'goal', value: Math.abs(current.goal.goalScore - previous.goal.goalScore), text: `Счёт цели: ${previous.goal.goalScore.toFixed(1)} → ${current.goal.goalScore.toFixed(1)}` },
    { key: 'debt', value: Math.abs(current.debt.totalDebt - previous.debt.totalDebt), text: `Долг: ${previous.debt.totalDebt.toFixed(1)} → ${current.debt.totalDebt.toFixed(1)}` },
    { key: 'recovery', value: Math.abs(current.antifragility.recoveryScore - previous.antifragility.recoveryScore), text: `Восстановление: ${previous.antifragility.recoveryScore.toFixed(1)} → ${current.antifragility.recoveryScore.toFixed(1)}` },
  ]

  return rows
    .sort((a, b) => (b.value - a.value) || a.key.localeCompare(b.key, 'ru'))
    .slice(0, 3)
}

export function buildFrameDiffTop3(current: FrameSnapshot, previous?: FrameSnapshot): string[] {
  return diffItems(current, previous).map((item) => item.text)
}

export function describeFrameChanges(current: FrameSnapshot, previous?: FrameSnapshot): string {
  return buildFrameDiffTop3(current, previous).join(' · ')
}
