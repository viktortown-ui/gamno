import type { MetricId } from '../../metrics'
import type { RegimeId } from '../../models/regime'
import type { InfluenceMatrix, MetricVector, WeightsSource } from '../influence/types'

export interface PlannedImpulse {
  day: number
  metricId: MetricId
  delta: number
}

export interface MultiversePlan {
  nameRu: string
  impulses: PlannedImpulse[]
}

export type ShockMode = 'off' | 'normal' | 'blackSwan'

export interface MultiverseConfig {
  horizonDays: 7 | 14 | 30 | 60
  runs: 1000 | 5000 | 10000 | 25000
  seed: number
  indexFloor: number
  collapseConstraintPct: number
  shockMode: ShockMode
  baseVector: MetricVector
  baseIndex: number
  basePCollapse: number
  baseRegime: RegimeId
  activeGoalWeights?: Partial<Record<MetricId, number>>
  matrix: InfluenceMatrix
  learnedStability?: InfluenceMatrix
  weightsSource: WeightsSource
  mix: number
  forecastResiduals?: number[]
  transitionMatrix: number[][]
  toggles: {
    forecastNoise: boolean
    weightsNoise: boolean
    stochasticRegime: boolean
  }
  plan: MultiversePlan
  audit: {
    forecastModelType?: string
    lags?: number
    trainedOnDays?: number
  }
}

export interface PathPoint {
  day: number
  index: number
  pCollapse: number
  siren: 'green' | 'amber' | 'red'
  goalScore?: number
  regimeId: RegimeId
}

export interface TailMetrics {
  redSirenAny: number
  indexFloorBreachAny: number
  expectedDeltaIndex: number
  expectedDeltaGoalScore: number
  expectedDeltaPCollapse: number
  probabilityIndexBelowFloorAtHorizon: number
  var5IndexLoss: number
  cvar5IndexLoss: number
  var5Collapse: number
  cvar5Collapse: number
}

export interface HedgeSuggestion {
  metricId: MetricId
  delta: number
  tailRiskImprovement: number
  noteRu: string
}

export interface MultiverseRunResult {
  generatedAt: number
  config: MultiverseConfig
  quantiles: {
    days: number[]
    index: { p10: number[]; p50: number[]; p90: number[] }
    pCollapse: { p10: number[]; p50: number[]; p90: number[] }
    goalScore?: { p10: number[]; p50: number[]; p90: number[] }
  }
  distributions: {
    horizonIndex: number[]
    horizonGoalScore?: number[]
  }
  tail: TailMetrics
  representativeWorstPath: PathPoint[]
  hedges: HedgeSuggestion[]
  audit: {
    weightsSource: WeightsSource
    mix: number
    forecastModelType?: string
    lags?: number
    trainedOnDays?: number
  }
  samplePaths: PathPoint[][]
  trajectoryExplorer: {
    probable: PathPoint[][]
    best: PathPoint[][]
    worst: PathPoint[][]
  }
  regimeMap: {
    horizon: Record<number, number>
    next1: Record<number, number>
    next3: Record<number, number>
  }
}

export interface RunMultiverseDeps {
  onProgress?: (done: number, total: number) => void
  shouldCancel?: () => boolean
}
