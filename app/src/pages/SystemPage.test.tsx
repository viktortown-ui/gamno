/* @vitest-environment jsdom */
import { act } from 'react'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../core/storage/db'

vi.mock('../ui/components/FanChart', () => ({
  FanChart: () => <div data-testid="fan-chart" />,
}))

vi.mock('../ui/components/WorldMapView', () => ({
  WorldMapView: ({ snapshot, onPlanetSelect, selectedPlanetId }: { snapshot: { planets: Array<{ id: string; labelRu: string }> }; onPlanetSelect?: (planetId: string | null, origin?: HTMLElement | null) => void; selectedPlanetId?: string | null }) => (
    <div>
      {snapshot.planets.map((planet) => (
        <button key={planet.id} type="button" className="mock-planet" data-selected={selectedPlanetId === planet.id} onClick={(event) => onPlanetSelect?.(planet.id, event.currentTarget)}>{planet.labelRu}</button>
      ))}
    </div>
  ),
}))

vi.mock('../repo/frameRepo', () => ({ getLastFrame: vi.fn(async () => ({ ts: 100, payload: { debt: { protocol: ['Закрыть петлю бюджета'] } } })) }))
vi.mock('../repo/forecastRepo', () => ({ getLatestForecastRun: vi.fn(async () => ({ ts: 200 })) }))
vi.mock('../repo/blackSwanRepo', () => ({ getLastBlackSwanRun: vi.fn(async () => ({ ts: 300, payload: { tail: { collapseTail: { es: 0.2, var: 0.15, tailMass: 0.08 } } } })) }))
vi.mock('../repo/multiverseRepo', () => ({ getLastRun: vi.fn(async () => ({ ts: 400, summary: { collapseTail: { es: 0.18, var: 0.14, tailMass: 0.07 } } })) }))

vi.mock('../core/workers/tailBacktestClient', () => ({
  createTailBacktestWorker: vi.fn(() => ({ terminate: vi.fn(), onmessage: null })),
  runTailBacktestInWorker: vi.fn((worker: { onmessage: ((ev: { data: unknown }) => void) | null }) => {
    worker.onmessage?.({ data: { type: 'done', result: { points: [], aggregates: [{ horizonDays: 3, policyMode: 'balanced', tailExceedRate: 0.25, tailLossRatio: 1.1, sampleCount: 8, warnings: [] }], warnings: [] } } })
  }),
}))

vi.mock('../core/workers/worldMapClient', () => ({
  createWorldMapWorker: vi.fn((onMessage: (message: unknown) => void) => ({ terminate: vi.fn(), _onMessage: onMessage })),
  runWorldMapInWorker: vi.fn((worker: { _onMessage: (message: unknown) => void }) => {
    worker._onMessage({
      type: 'done',
      result: {
        id: 'world-map:2026-01-15:12:1100x540',
        ts: 1730000000000,
        seed: 12,
        viewport: { width: 1100, height: 540, padding: 24 },
        center: { x: 550, y: 270 },
        metrics: { level: 4, risk: 0.5, esCollapse10: 0.2, failProbability: 0.2, budgetPressure: 0.1, safeMode: false, sirenLevel: 'green' },
        rings: [],
        storms: [],
        domains: [],
        planets: [
          { id: 'planet:core:0', domainId: 'core', order: 1, labelRu: 'Индекс', weight: 0.2, importance: 0.3, radius: 10, x: 100, y: 90, angle: 0, metrics: { level: 4, risk: 0.2, esCollapse10: 0.1, failProbability: 0.13, budgetPressure: 0.2, safeMode: false, sirenLevel: 'green' }, renderHints: { hasStorm: false, stormStrength: 0.2, tailRisk: 0.2, drawTailGlow: false } },
          { id: 'planet:core:1', domainId: 'core', order: 2, labelRu: 'Уровень', weight: 0.2, importance: 0.3, radius: 10, x: 180, y: 90, angle: 0, metrics: { level: 4, risk: 0.2, esCollapse10: 0.1, failProbability: 0.23, budgetPressure: 0.3, safeMode: false, sirenLevel: 'amber' }, renderHints: { hasStorm: true, stormStrength: 0.5, tailRisk: 0.3, drawTailGlow: true } },
        ],
      },
    })
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
    learnedMatrices: { toArray: vi.fn(async () => [{ trainedOnDays: 45, lags: 2 }, { trainedOnDays: 36, lags: 2 }]) },
    forecastRuns: { orderBy: vi.fn(() => ({ reverse: () => ({ limit: () => ({ toArray: async () => [{ backtest: { averageIntervalWidth: 0.4, rows: [{ p10: 0, p90: 1, actual: 0.8, insideBand: 1 }] } }] }) }) })) },
    actionAudits: {
      orderBy: vi.fn(() => ({ reverse: () => ({ limit: () => ({ toArray: async () => [{
        whyTopRu: ['Рычаг снижает риск', 'Укладывается в бюджет', 'Стабилен на горизонте'],
        modelHealth: { v: 1, kind: 'policy', grade: 'yellow', reasonsRu: ['Калибровка умеренная.'], data: { samples: 9, minSamples: 6, sufficient: true }, calibration: { brier: 0.18, worstGap: 0.13, bins: Array.from({ length: 10 }, (_, index) => ({ index, left: index / 10, right: (index + 1) / 10, count: 1, meanProbability: 0.1 * index, observedRate: 0.08 * index, gap: 0.02 })) }, drift: { triggered: false, triggerIndex: null, score: 0.05 } },
        horizonSummary: [
          { horizonDays: 7, policyMode: 'balanced', actionId: 'focus:single-thing', stats: { mean: 0, p10: 0.2, p50: 0.6, p90: 0.8, tail: 0.1, var97_5: 0.75, es97_5: 0.3, tailMass: 0.09, failRate: 0.2 } },
          { horizonDays: 7, policyMode: 'balanced', actionId: 'focus:deep-25', stats: { mean: 0, p10: 0.2, p50: 0.6, p90: 0.8, tail: 0.1, var97_5: 0.75, es97_5: 0.2, tailMass: 0.09, failRate: 0.15 } },
          { horizonDays: 7, policyMode: 'risk', actionId: 'focus:no-notify-60', stats: { mean: 0, p10: 0.2, p50: 0.55, p90: 0.72, tail: 0.1, var97_5: 0.75, es97_5: 0.2, tailMass: 0.09, failRate: 0.12 } },
        ],
      }] }) }) })),
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
  it('opens panel from map and restores focus on close', async () => {
    const { SystemPage } = await import('./SystemPage')
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => { root.render(<SystemPage />) })
    await act(async () => { await flush() })

    const firstPlanet = container.querySelectorAll<HTMLButtonElement>('.mock-planet')[0]
    expect(firstPlanet).toBeTruthy()

    await act(async () => {
      firstPlanet?.click()
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })

    expect(container.textContent).toContain('Брифинг')

    const close = container.querySelector<HTMLButtonElement>('.planet-panel__close')
    await act(async () => {
      close?.click()
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })

    expect(container.querySelector('.planet-panel')).toBeNull()
    expect(document.activeElement).toBe(firstPlanet)

    await act(async () => { root.unmount() })
    container.remove()
  })

  it('switches panel content without stacking and supports browser back dismiss', async () => {
    const { SystemPage } = await import('./SystemPage')
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => { root.render(<SystemPage />) })
    await act(async () => { await flush() })

    const planets = container.querySelectorAll<HTMLButtonElement>('.mock-planet')
    await act(async () => { planets[0]?.click(); window.dispatchEvent(new HashChangeEvent('hashchange')) })
    await act(async () => { planets[1]?.click(); window.dispatchEvent(new HashChangeEvent('hashchange')) })

    expect(container.querySelectorAll('.planet-panel').length).toBe(1)
    expect(container.textContent).toContain('Уровень')

    await act(async () => {
      window.location.hash = '#/system'
      window.dispatchEvent(new HashChangeEvent('hashchange'))
      await flush()
    })

    expect(container.querySelector('.planet-panel')).toBeNull()

    await act(async () => { root.unmount() })
    container.remove()
  })


  it('opens panel from hash deep-link', async () => {
    window.location.hash = '#/system?planet=planet:core:1'
    const { SystemPage } = await import('./SystemPage')
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => { root.render(<SystemPage />) })
    await act(async () => { await flush() })

    expect(container.querySelector('.planet-panel')).toBeTruthy()
    expect(container.textContent).toContain('Уровень')

    await act(async () => { root.unmount() })
    container.remove()
  })

  it('renders world map and strong empty-state when history is missing', async () => {
    vi.mocked(db.checkins.count).mockResolvedValueOnce(0)
    vi.mocked(db.frameSnapshots.count).mockResolvedValueOnce(0)

    const { SystemPage } = await import('./SystemPage')
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => { root.render(<SystemPage />) })
    await act(async () => { await flush() })

    expect(container.querySelectorAll('.mock-planet').length).toBeGreaterThan(0)
    expect(container.textContent).toContain('Недостаточно данных для истории')
    expect(container.textContent).toContain('Сделать первый чек-ин')

    await act(async () => { root.unmount() })
    container.remove()
  })

  it('sorts levers deterministically with tie-breakers', async () => {
    const { SystemPage } = await import('./SystemPage')
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => { root.render(<SystemPage />) })
    await act(async () => { await flush() })

    const firstPlanet = container.querySelectorAll<HTMLButtonElement>('.mock-planet')[0]
    await act(async () => { firstPlanet?.click(); window.dispatchEvent(new HashChangeEvent('hashchange')) })

    const planets = [...container.querySelectorAll<HTMLButtonElement>('.mock-planet')].map((el) => el.textContent)
    expect(planets).toEqual(['Индекс', 'Уровень'])

    const leverRows = [...container.querySelectorAll('.planet-panel__levers li strong')].map((el) => el.textContent)
    expect(leverRows[0]).toContain('Глубокий фокус 25 минут')

    await act(async () => { root.unmount() })
    container.remove()
  })
})
