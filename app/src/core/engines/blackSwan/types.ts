import type { CheckinRecord } from '../../models/checkin'
import type { InfluenceMatrix, WeightsSource } from '../influence/types'
import type { MetricId } from '../../metrics'

export interface DailyMetricShock {
  metricId: MetricId
  delta: number
  durationDays: number
  startLagDays?: number
  mode?: 'step' | 'daily'
}

export interface BlackSwanScenarioSpec {
  id?: number
  nameRu: string
  horizonDays?: 7 | 14 | 30
  sims?: 500 | 2000 | 10000
  noise?: number
  correlationTag?: 'здоровье' | 'работа' | 'социум' | 'деньги' | 'комбо'
  shocks: DailyMetricShock[]
}

export interface BlackSwanSettings {
  horizonDays: 7 | 14 | 30
  simulations: 500 | 2000 | 10000
  noiseMultiplier: number
  thresholdCollapse: number
  alpha: number
  weightsSource: WeightsSource
  mix: number
  targetRedProb: number
}

export interface BlackSwanInput {
  baseRecord: CheckinRecord
  history: CheckinRecord[]
  matrix: InfluenceMatrix
  learnedLag?: 1 | 2 | 3
  settings: BlackSwanSettings
  scenario?: BlackSwanScenarioSpec
  seed: number
}

export interface QuantileSeries { p10: number[]; p50: number[]; p90: number[] }

export interface BlackSwanResult {
  generatedAt: number
  horizonDays: number
  simulations: number
  seed: number
  coreIndex: QuantileSeries
  pCollapse: QuantileSeries
  days: number[]
  histogram: Array<{ bucket: string; value: number }>
  tail: { probEverRed: number; probThresholdEnd: number; probThresholdEver: number; esCoreIndex: number; esCollapse: number }
  topDrivers: Array<{ metricId: MetricId; labelRu: string; delta: number }>
  recommendations: Array<{ metricId: MetricId; actionRu: string; delta: number; effectIndex: { p10: number; p50: number; p90: number }; effectCollapse: { p10: number; p50: number; p90: number } }>
  noteRu: string
  summary: { pRed7d: number; esCollapse10: number; sirenLevel: 'green' | 'amber' | 'red' }
}
