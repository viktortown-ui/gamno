import { describe, expect, it } from 'vitest'
import { conditionalVaR, valueAtRisk } from './tail'

describe('tail risk utils', () => {
  it('CVaR ухудшается при более тяжёлых потерях', () => {
    const mild = [1, 2, 3, 4, 5, 6]
    const severe = [1, 2, 3, 8, 9, 10]
    expect(conditionalVaR(severe, 0.8)).toBeGreaterThan(conditionalVaR(mild, 0.8))
  })

  it('VaR не ниже медианы для alpha=0.5', () => {
    const losses = [0, 1, 2, 3, 4]
    expect(valueAtRisk(losses, 0.5)).toBeGreaterThanOrEqual(2)
  })
})
