import { beforeEach, describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'

;(globalThis as unknown as { self: typeof globalThis }).self = globalThis

describe('forecastRepo', () => {
  beforeEach(async () => {
    const { clearAllData } = await import('../core/storage/repo')
    await clearAllData()
  })

  it('сохраняет и читает последний запуск', async () => {
    const { saveForecastRun, getLatestForecastRun } = await import('./forecastRepo')

    await saveForecastRun({
      ts: Date.now(),
      config: { horizon: 7, simulations: 500, backtestWindow: 30, seed: 42 },
      trainedOnDays: 40,
      horizons: [1, 2, 3],
      modelType: 'ses',
      residualStats: { std: 1.2, sample: 20 },
      backtest: { mae: 0.5, rmse: 0.7, coverage: 77, averageIntervalWidth: 3, rows: [] },
      index: { point: [1], p10: [0], p50: [1], p90: [2] },
    })

    const latest = await getLatestForecastRun()
    expect(latest).toBeDefined()
    expect(latest?.modelType).toBe('ses')
  })
})
