/* @vitest-environment jsdom */
import { act } from 'react'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../repo/frameRepo', () => ({ getLastFrame: vi.fn(async () => ({ ts: 100 })) }))
vi.mock('../repo/forecastRepo', () => ({ getLatestForecastRun: vi.fn(async () => ({ ts: 200 })) }))
vi.mock('../repo/blackSwanRepo', () => ({ getLastBlackSwanRun: vi.fn(async () => ({ ts: 300, payload: { tail: { collapseTail: { es: 0.2, var: 0.15, tailMass: 0.08 } } } })) }))
vi.mock('../repo/multiverseRepo', () => ({ getLastRun: vi.fn(async () => ({ ts: 400, summary: { collapseTail: { es: 0.18, var: 0.14, tailMass: 0.07 } } })) }))

vi.mock('../core/storage/db', () => ({
  schemaVersion: 9,
  db: {
    checkins: { count: vi.fn(async () => 1) },
    events: { count: vi.fn(async () => 2) },
    frameSnapshots: { count: vi.fn(async () => 3) },
    multiverseRuns: { count: vi.fn(async () => 4) },
    learnedMatrices: {
      toArray: vi.fn(async () => [
        { trainedOnDays: 45, lags: 2 },
        { trainedOnDays: 36, lags: 2 },
      ]),
    },
    forecastRuns: {
      orderBy: vi.fn(() => ({ reverse: () => ({ limit: () => ({ toArray: async () => [{ backtest: { averageIntervalWidth: 0.4, rows: [{ p10: 0, p90: 1, actual: 0.8, insideBand: 1 }] } }] }) }) })),
    },
    actionAudits: {
      orderBy: vi.fn(() => ({ reverse: () => ({ limit: () => ({ toArray: async () => [{ modelHealth: { v: 1, kind: 'policy', grade: 'yellow', reasonsRu: ['Калибровка умеренная.'], data: { samples: 9, minSamples: 6, sufficient: true }, calibration: { brier: 0.18, worstGap: 0.13, bins: Array.from({ length: 10 }, (_, index) => ({ index, left: index / 10, right: (index + 1) / 10, count: 1, meanProbability: 0.1 * index, observedRate: 0.08 * index, gap: 0.02 }) ) }, drift: { triggered: false, triggerIndex: null, score: 0.05 } }, horizonSummary: [{ horizonDays: 3, policyMode: 'balanced', actionId: 'bal:1', stats: { mean: 0, p10: 0, p50: 0, p90: 0, tail: 0, var97_5: 0.11, es97_5: 0.16, tailMass: 0.09, failRate: 0.12 } }] }] }) }) })),
    },
  },
}))

describe('SystemPage', () => {
  it('renders Calibration & Trust block with learned/forecast/policy cards', async () => {
    const { SystemPage } = await import('./SystemPage')
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(<SystemPage />)
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(container.textContent).toContain('Calibration & Trust')
    expect(container.textContent).toContain('Learned')
    expect(container.textContent).toContain('Forecast')
    expect(container.textContent).toContain('Policy')
    expect(container.textContent).toContain('Brier:')
    expect(container.querySelectorAll('svg').length).toBeGreaterThan(0)
    expect(container.textContent).toContain('Tail-Risk unified')
    expect(container.textContent).toContain('BlackSwans')
    expect(container.textContent).toContain('Multiverse')
    expect(container.textContent).toContain('Autopilot')
  })
})
