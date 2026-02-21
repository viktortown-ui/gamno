/* @vitest-environment jsdom */
import { act } from 'react'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

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

vi.mock('../ui/components/WorldMapView', () => ({
  WorldMapView: ({ snapshot, onPlanetSelect }: { snapshot: { planets: Array<{ id: string; labelRu: string }> }; onPlanetSelect?: (planetId: string | null, origin?: HTMLElement | null) => void }) => (
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

vi.mock('../core/storage/db', () => ({
  db: {
    frameSnapshots: {
      orderBy: vi.fn(() => ({ reverse: () => ({ limit: () => ({ toArray: async () => [
        { id: 1, ts: 1000, payload: { ts: 1000, regimeSnapshot: { disarmProtocol: [], sirenLevel: 'green', pCollapse: 0.1 }, tailRiskSummary: { esCollapse10: 0.2 }, goal: { active: { title: 'Цель 1' } }, debt: { protocol: [] } } },
        { id: 2, ts: 2000, payload: { ts: 2000, regimeSnapshot: { disarmProtocol: ['on'], sirenLevel: 'amber', pCollapse: 0.2 }, tailRiskSummary: { esCollapse10: 0.3 }, goal: { active: { title: 'Цель 2' } }, debt: { protocol: ['x'] } } },
      ] }) }) })),
    },
    actionAudits: { orderBy: vi.fn(() => ({ reverse: () => ({ limit: () => ({ toArray: async () => [{ whyTopRu: ['ok'], horizonSummary: [], modelHealth: { grade: 'green' } }] }) }) })) },
  },
}))

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('WorldPage', () => {
  it('supports deep-link planet panel and deterministic replay scrub', async () => {
    window.location.hash = '#/world?planet=planet:core:0'
    const { WorldPage } = await import('./WorldPage')
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => { root.render(<WorldPage />) })
    await act(async () => { await flush() })

    expect(container.querySelector('.planet-panel')).toBeTruthy()

    const slider = container.querySelector<HTMLInputElement>('#world-replay')
    expect(slider).toBeTruthy()

    const initialSnapshotLine = container.querySelector('.world-replay .mono')?.textContent
    await act(async () => {
      if (slider) {
        slider.value = '0'
        slider.dispatchEvent(new Event('input', { bubbles: true }))
        slider.dispatchEvent(new Event('change', { bubbles: true }))
      }
      await flush()
    })
    await act(async () => {
      if (slider) {
        slider.value = '1'
        slider.dispatchEvent(new Event('input', { bubbles: true }))
        slider.dispatchEvent(new Event('change', { bubbles: true }))
      }
      await flush()
    })

    expect(runWorldMapInWorkerMock).toHaveBeenCalled()
    const finalSnapshotLine = container.querySelector('.world-replay .mono')?.textContent
    expect(finalSnapshotLine).toBe(initialSnapshotLine)

    await act(async () => { root.unmount() })
    container.remove()
  })
})
