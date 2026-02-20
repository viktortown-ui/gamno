import { describe, expect, it } from 'vitest'
import { runBlackSwan } from '../core/engines/blackSwan'
import { defaultInfluenceMatrix } from '../core/engines/influence/influence'

describe('black swan worker entry', () => {
  it('runs pure entry used by worker', () => {
    const base = { ts: Date.now(), energy: 5, focus: 5, mood: 5, stress: 5, sleepHours: 7, social: 5, productivity: 5, health: 5, cashFlow: 0 }
    const result = runBlackSwan({ baseRecord: base, history: [base], matrix: defaultInfluenceMatrix, settings: { horizonDays: 7, simulations: 500, noiseMultiplier: 1, thresholdCollapse: 0.35, alpha: 0.1, weightsSource: 'manual', mix: 0, targetRedProb: 0.1 }, seed: 1 })
    expect(result.days.length).toBe(7)
  })
})
