import type { PolicyConstraints, PolicyMode, PolicyStateVector, PolicyTuning } from './index'

export type PolicyHorizon = 3 | 7

export interface HorizonSummaryCompact {
  mean: number
  p10: number
  p50: number
  p90: number
  tail: number
  failRate: number
}

export interface HorizonCandidateResult {
  actionId: string
  mode: PolicyMode
  score: number
  penalty: number
  horizon: PolicyHorizon
  summary: HorizonSummaryCompact
}

export interface PolicyHorizonWorkerInput {
  state: PolicyStateVector
  constraints: PolicyConstraints
  seed: number
  topK: number
  tuning: PolicyTuning
}

export interface PolicyHorizonWorkerOutput {
  byHorizon: Record<PolicyHorizon, Record<PolicyMode, HorizonCandidateResult[]>>
  bestByPolicy: Record<PolicyMode, Record<PolicyHorizon, HorizonCandidateResult>>
}
