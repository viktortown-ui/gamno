/* @vitest-environment jsdom */
import { act } from 'react'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../repo/frameRepo', () => ({ getLastFrame: vi.fn(async () => ({ ts: 100, payload: { debt: { protocol: [] } } })) }))
vi.mock('../repo/forecastRepo', () => ({ getLatestForecastRun: vi.fn(async () => ({ ts: 200 })) }))
vi.mock('../repo/blackSwanRepo', () => ({ getLastBlackSwanRun: vi.fn(async () => ({ ts: 300, payload: { tail: { collapseTail: { es: 0.2, var: 0.15, tailMass: 0.08 } } } })) }))

vi.mock('../core/engines/analytics/modelHealth', () => ({
  evaluateModelHealth: vi.fn(() => ({ kind: 'policy', grade: 'green', reasonsRu: [], data: { samples: 1, minSamples: 1, sufficient: true }, calibration: { brier: 0, worstGap: 0, bins: [] }, drift: { triggered: false, triggerIndex: null, score: 0 } })),
}))

vi.mock('../repo/multiverseRepo', () => ({ getLastRun: vi.fn(async () => ({ ts: 400, summary: { collapseTail: { es: 0.18, var: 0.14, tailMass: 0.07 } } })) }))

vi.mock('../core/workers/tailBacktestClient', () => ({
  createTailBacktestWorker: vi.fn(() => ({ terminate: vi.fn(), onmessage: null })),
  runTailBacktestInWorker: vi.fn((worker: { onmessage: ((ev: { data: unknown }) => void) | null }) => {
    worker.onmessage?.({ data: { type: 'done', result: { points: [], aggregates: [{ horizonDays: 3, policyMode: 'balanced', tailExceedRate: 0.25, tailLossRatio: 1.1, sampleCount: 8, warnings: [] }], warnings: [] } } })
  }),
}))

vi.mock('../core/storage/db', () => ({
  schemaVersion: 9,
  db: {
    checkins: { count: vi.fn(async () => 1) },
    events: { count: vi.fn(async () => 2) },
    frameSnapshots: {
      count: vi.fn(async () => 3),
      orderBy: vi.fn(() => ({ toArray: async () => [{ ts: 10, payload: { stateSnapshot: { index: 100 } } }] })),
    },
    multiverseRuns: { count: vi.fn(async () => 4) },
    learnedMatrices: { toArray: vi.fn(async () => [{ trainedOnDays: 45, lags: 2 }]) },
    forecastRuns: { orderBy: vi.fn(() => ({ reverse: () => ({ limit: () => ({ toArray: async () => [{ backtest: { averageIntervalWidth: 0.4, rows: [{ p10: 0, p90: 1, insideBand: 1 }] } }] }) }) })) },
    actionAudits: {
      orderBy: vi.fn(() => ({ reverse: () => ({ limit: () => ({ toArray: async () => [{ ts: 1, safeMode: true, chosenActionId: 'a', gatesApplied: [], gateReasonsRu: [], horizonSummary: [{ horizonDays: 7, policyMode: 'balanced', actionId: 'a', stats: { es97_5: 0.1, var97_5: 0.2, tailMass: 0.2, failRate: 0.1 } }], modelHealth: undefined }] }) }) })),
    },
  },
}))

beforeEach(() => {
  window.location.hash = '#/system'
})

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('SystemPage', () => {
  it('shows world link instead of embedded map', async () => {
    const { SystemPage } = await import('./SystemPage')
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => { root.render(<SystemPage />) })
    await act(async () => { await flush() })

    const link = container.querySelector<HTMLAnchorElement>('a[href="#/world"]')
    expect(link).toBeTruthy()
    expect(container.textContent).toContain('Полный cockpit теперь открыт на отдельной странице')

    await act(async () => { root.unmount() })
    container.remove()
  })
})
