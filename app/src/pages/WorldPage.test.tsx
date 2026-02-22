/* @vitest-environment jsdom */
import { act } from 'react'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const runWorldMapInWorkerMock = vi.fn((worker: { _onMessage: (message: unknown) => void }, input: { frame: { ts: number }; seed: number; viewport: { width: number; height: number; padding: number } }) => {
  worker._onMessage({
    type: 'done',
    result: {
      id: `snapshot:${input.seed}:${input.frame.ts}:${input.viewport.width}x${input.viewport.height}`,
      ts: input.frame.ts,
      seed: input.seed,
      viewport: input.viewport,
      center: { x: 500, y: 300 },
      metrics: { level: 4, risk: 0.5, esCollapse10: 0.2, failProbability: 0.2, budgetPressure: 0.1, safeMode: false, sirenLevel: 'green' },
      rings: [],
      storms: [],
      domains: [],
      planets: [
        { id: 'planet:core:0', domainId: 'core', order: 1, labelRu: 'Индекс', weight: 0.2, importance: 0.3, radius: 10, x: 100, y: 90, angle: 0, metrics: { level: 4, risk: 0.2, esCollapse10: 0.1, failProbability: 0.13, budgetPressure: 0.2, safeMode: false, sirenLevel: 'green' }, renderHints: { hasStorm: false, stormStrength: 0.2, tailRisk: 0.2, drawTailGlow: false } },
      ],
    },
  })
})

vi.mock('../ui/components/FanChart', () => ({ FanChart: () => <div data-testid="fan-chart" /> }))
vi.mock('../ui/components/WorldWebGLScene', () => ({
  WorldWebGLScene: ({ snapshot, onPlanetSelect }: { snapshot: { planets: Array<{ labelRu: string }> }; onPlanetSelect?: (planetId: string | null, origin?: HTMLElement | null) => void }) => (
    <div data-testid="webgl-scene">
      <canvas data-testid="world-canvas" />
      <span data-testid="snapshot-id">{snapshot.planets[0]?.labelRu}</span>
      <button type="button" onClick={(event) => onPlanetSelect?.('planet:core:0', event.currentTarget)}>pick</button>
    </div>
  ),
}))

vi.mock('../ui/components/WorldMapView', () => ({
  WorldMapView: ({ snapshot, onPlanetSelect }: { snapshot: { planets: Array<{ labelRu: string }> }; onPlanetSelect?: (planetId: string | null, origin?: HTMLElement | null) => void }) => (
    <div>
      <span data-testid="snapshot-id">{snapshot.planets[0]?.labelRu}</span>
      <button type="button" onClick={(event) => onPlanetSelect?.('planet:core:0', event.currentTarget)}>pick</button>
    </div>
  ),
}))
vi.mock('../core/workers/worldMapClient', () => ({
  createWorldMapWorker: vi.fn((onMessage: (message: unknown) => void) => ({ terminate: vi.fn(), _onMessage: onMessage })),
  runWorldMapInWorker: runWorldMapInWorkerMock,
}))

const navigateMock = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigateMock }
})

const seededFrameRows = [
  { id: 1, ts: 1000, payload: { ts: 1000, regimeSnapshot: { disarmProtocol: [], sirenLevel: 'green', pCollapse: 0.1 }, tailRiskSummary: { esCollapse10: 0.2 }, goal: { active: { title: 'Цель 1' } }, debt: { protocol: [] } } },
  { id: 2, ts: 2000, payload: { ts: 2000, regimeSnapshot: { disarmProtocol: ['on'], sirenLevel: 'amber', pCollapse: 0.2 }, tailRiskSummary: { esCollapse10: 0.3 }, goal: { active: { title: 'Цель 2' } }, debt: { protocol: ['x'] } } },
]

const dbMock = vi.hoisted(() => ({
  frameRows: [
    { id: 1, ts: 1000, payload: { ts: 1000, regimeSnapshot: { disarmProtocol: [], sirenLevel: 'green', pCollapse: 0.1 }, tailRiskSummary: { esCollapse10: 0.2 }, goal: { active: { title: 'Цель 1' } }, debt: { protocol: [] } } },
    { id: 2, ts: 2000, payload: { ts: 2000, regimeSnapshot: { disarmProtocol: ['on'], sirenLevel: 'amber', pCollapse: 0.2 }, tailRiskSummary: { esCollapse10: 0.3 }, goal: { active: { title: 'Цель 2' } }, debt: { protocol: ['x'] } } },
  ],
  audits: [{ whyTopRu: ['ok'], horizonSummary: [{ horizonDays: 7, policyMode: 'balanced', actionId: 'focus:deep-25', stats: { mean: 0, p10: 0, p50: 0.4, p90: 0.6, tail: 0.2, es97_5: 0.3, failRate: 0.1 } }], modelHealth: { grade: 'green', reasonsRu: ['Stable'] } }],
}))

vi.mock('../core/storage/db', () => ({
  db: {
    frameSnapshots: { orderBy: vi.fn(() => ({ reverse: () => ({ limit: () => ({ toArray: async () => dbMock.frameRows }) }) })) },
    actionAudits: { orderBy: vi.fn(() => ({ reverse: () => ({ limit: () => ({ toArray: async () => dbMock.audits }) }) })) },
  },
}))

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('WorldPage', () => {
  beforeEach(() => {
    window.location.hash = '#/world'
    window.localStorage.clear()
    dbMock.frameRows = [...seededFrameRows]
    navigateMock.mockReset()
  })

  
  it('renders webgl mode by default with canvas smoke check', async () => {
    const { WorldPage } = await import('./WorldPage')
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => { root.render(<WorldPage />) })
    await act(async () => { await flush() })

    expect(container.querySelector('[data-testid="world-canvas"]')).toBeTruthy()

    await act(async () => { root.unmount() })
    container.remove()
  })


  it('opens planet panel from deep-link hash on initial load', async () => {
    window.location.hash = '#/world?planet=planet:core:0'
    const { WorldPage } = await import('./WorldPage')
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => { root.render(<WorldPage />) })
    await act(async () => { await flush() })

    expect(container.querySelector('.planet-panel')).toBeTruthy()

    await act(async () => { root.unmount() })
    container.remove()
  })

  it('supports planet panel open and back-close by hash', async () => {
    const { WorldPage } = await import('./WorldPage')
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => { root.render(<WorldPage />) })
    await act(async () => { await flush() })

    expect(container.querySelector('.world-hud-grid')?.textContent ?? '').toContain('P(collapse)')
    expect(container.querySelector('.planet-panel')).toBeFalsy()

    await act(async () => {
      container.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      window.dispatchEvent(new HashChangeEvent('hashchange'))
      await flush()
    })
    expect(container.querySelector('.planet-panel')).toBeTruthy()

    await act(async () => {
      window.location.hash = '#/world'
      window.dispatchEvent(new HashChangeEvent('hashchange'))
      await flush()
    })
    expect(container.querySelector('.planet-panel')).toBeFalsy()

    await act(async () => { root.unmount() })
    container.remove()
  })


  it('toggles action rail and persists collapsed state', async () => {
    const { WorldPage } = await import('./WorldPage')
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => { root.render(<WorldPage />) })
    await act(async () => { await flush() })

    const collapse = Array.from(container.querySelectorAll('button')).find((item) => item.textContent?.includes('Свернуть')) as HTMLButtonElement | undefined
    await act(async () => { collapse?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })

    expect(window.localStorage.getItem('world:action-rail:collapsed')).toBe('1')
    expect(container.querySelector('.world-action-rail__collapsed-cta')).toBeTruthy()

    const cta = container.querySelector('.world-action-rail__collapsed-cta') as HTMLButtonElement | null
    await act(async () => { cta?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(window.localStorage.getItem('world:action-rail:collapsed')).toBe('0')

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }))
      await flush()
    })
    expect(window.localStorage.getItem('world:action-rail:collapsed')).toBe('1')

    await act(async () => { root.unmount() })
    container.remove()
  })

  it('next action CTA routes to first check-in when data is missing', async () => {
    dbMock.frameRows = []
    const { WorldPage } = await import('./WorldPage')
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => { root.render(<WorldPage />) })
    await act(async () => { await flush() })

    const cta = container.querySelector('aside .start-primary') as HTMLButtonElement | null
    await act(async () => { cta?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })

    expect(navigateMock).toHaveBeenCalledWith('/core')

    await act(async () => { root.unmount() })
    container.remove()
  })

  it('next action CTA opens planet drill-down when data exists', async () => {
    const { WorldPage } = await import('./WorldPage')
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => { root.render(<WorldPage />) })
    await act(async () => { await flush() })

    const cta = container.querySelector('aside .start-primary') as HTMLButtonElement | null
    await act(async () => {
      cta?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      window.dispatchEvent(new HashChangeEvent('hashchange'))
      await flush()
    })

    expect(window.location.hash).toContain('planet=')
    expect(navigateMock).not.toHaveBeenCalled()

    await act(async () => { root.unmount() })
    container.remove()
  })
})
