import { describe, expect, it } from 'vitest'
import { buildStateVector, type PolicyConstraints } from './index'
import { evaluatePolicyHorizonInWorker } from './policyHorizon.worker'
import type { CheckinRecord } from '../../models/checkin'

;(globalThis as unknown as { self: typeof globalThis }).self = globalThis

const checkin: CheckinRecord = {
  ts: 1710000000000,
  energy: 6,
  focus: 6,
  mood: 6,
  stress: 4,
  sleepHours: 7,
  social: 5,
  productivity: 6,
  health: 6,
  cashFlow: 1000,
}

const constraints: PolicyConstraints = {
  maxPCollapse: 0.02,
  sirenCap: 0.02,
  maxDebtGrowth: 0.2,
  minRecoveryScore: 55,
}

describe('policy horizon worker', () => {
  it('deterministic for fixed seed and state', () => {
    const state = buildStateVector({ latestCheckin: checkin, checkins: [checkin], activeGoal: null })
    const input = { state, constraints, seed: 77, topK: 4, tuning: { load: 0, cautious: 0 } }
    const first = evaluatePolicyHorizonInWorker(input)
    const second = evaluatePolicyHorizonInWorker(input)
    expect(first).toEqual(second)
    expect(first.byHorizon[3].balanced.length).toBeGreaterThan(0)
    expect(first.byHorizon[7].risk.length).toBeGreaterThan(0)
  })
})
