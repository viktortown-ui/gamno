import { describe, expect, it } from 'vitest'
import { runRollingBacktest } from './backtest'

describe('backtest', () => {
  it('считает покрытие и ошибки на rolling origin', () => {
    const values = [40, 41, 42, 42, 43, 44, 45, 45, 46, 47]
    const dates = values.map((_, i) => `2025-01-${String(i + 1).padStart(2, '0')}`)

    const summary = runRollingBacktest(dates, values, 5, 200, 99)

    expect(summary.rows).toHaveLength(5)
    expect(summary.coverage).toBeGreaterThanOrEqual(0)
    expect(summary.coverage).toBeLessThanOrEqual(100)
    expect(summary.mae).toBeGreaterThanOrEqual(0)
  })
})
