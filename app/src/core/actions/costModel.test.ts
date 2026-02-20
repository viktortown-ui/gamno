import { describe, expect, it } from 'vitest'
import { penaltyScore } from './costModel'

describe('costModel', () => {
  it('deterministic penaltyScore', () => {
    const cost = { timeMin: 20, energy: 5, money: 100, timeDebt: 0.1, risk: 0.03, entropy: 0.05 }
    const weights = { timeMin: 0.02, energy: 0.03, money: 0.001, timeDebt: 1.2, risk: 2.4, entropy: 0.7 }
    const budget = { maxTimeMin: 60, maxEnergy: 15, maxMoney: 500, maxTimeDebt: 0.2, maxRisk: 0.1, maxEntropy: 0.2 }
    expect(penaltyScore(cost, weights, budget)).toBe(penaltyScore(cost, weights, budget))
  })

  it('adds hard penalty for budget violation', () => {
    const weights = { timeMin: 0.02, energy: 0.03, money: 0.001, timeDebt: 1.2, risk: 2.4, entropy: 0.7 }
    const budget = { maxTimeMin: 60, maxEnergy: 15, maxMoney: 500, maxTimeDebt: 0.2, maxRisk: 0.1, maxEntropy: 0.2 }
    const within = penaltyScore({ timeMin: 20, energy: 5, money: 100, timeDebt: 0.1, risk: 0.03, entropy: 0.05 }, weights, budget)
    const violated = penaltyScore({ timeMin: 120, energy: 30, money: 100, timeDebt: 0.6, risk: 0.3, entropy: 0.4 }, weights, budget)
    expect(violated - within).toBeGreaterThan(10000)
  })
})
