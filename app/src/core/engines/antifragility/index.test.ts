import { describe, expect, it } from 'vitest'
import { computeAntifragility, computeRecoveryScore, computeShockBudget } from './index'
import type { AntifragilityDayInput } from './index'

function makeSeries(params: { debt?: number; siren?: 'green' | 'amber' | 'red'; fastRecovery?: boolean }): AntifragilityDayInput[] {
  const debt = params.debt ?? 1
  const siren = params.siren ?? 'green'
  const values = params.fastRecovery ? [7, 5.5, 6.8, 7.1, 7.2] : [7, 5.5, 5.7, 5.8, 6]
  return values.map((index, idx) => ({
    dayKey: `2026-01-0${idx + 1}`,
    index,
    pCollapse: idx === 1 ? 0.24 : 0.14,
    sirenLevel: siren === 'red' ? 'red' : idx === 1 ? siren : 'green',
    volatility: 0.8,
    entropy: 0.9,
    drift: 0.7,
    timeDebtTotal: debt,
    regimeId: 3,
  }))
}

describe('antifragility engine', () => {
  it('детерминированный расчёт', () => {
    const series = makeSeries({ fastRecovery: true })
    const first = computeAntifragility({ series, sessions: [], tailRisk: 0.1 })
    const second = computeAntifragility({ series, sessions: [], tailRisk: 0.1 })
    expect(first).toEqual(second)
  })

  it('монтоничность бюджета: хуже долг/сирена => меньше бюджет', () => {
    const good = computeShockBudget({ sirenLevel: 'green', debtTotal: 1, pCollapse: 0.1, regimeId: 3 })
    const badDebt = computeShockBudget({ sirenLevel: 'green', debtTotal: 3, pCollapse: 0.1, regimeId: 3 })
    const badSiren = computeShockBudget({ sirenLevel: 'red', debtTotal: 1, pCollapse: 0.1, regimeId: 3 })
    expect(good).toBeGreaterThanOrEqual(badDebt)
    expect(good).toBeGreaterThanOrEqual(badSiren)
  })

  it('быстрое восстановление даёт выше RecoveryScore', () => {
    const slow = computeRecoveryScore(makeSeries({ fastRecovery: false }))
    const fast = computeRecoveryScore(makeSeries({ fastRecovery: true }))
    expect(fast).toBeGreaterThan(slow)
  })

  it('Siren RED отключает предложения встрясок', () => {
    const result = computeAntifragility({ series: makeSeries({ siren: 'red', debt: 1 }), sessions: [], tailRisk: 0.1 })
    expect(result.shockBudget).toBe(0)
    expect(result.suggestions).toHaveLength(0)
  })
})
