/* @vitest-environment jsdom */
import { act } from 'react'
import { createRoot } from 'react-dom/client'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import { describe, expect, it, vi } from 'vitest'
import { buildWorldMapSnapshot } from '../../core/worldMap/buildWorldMapSnapshot'
import type { FrameSnapshot } from '../../core/frame/frameEngine'
import { WorldMapView } from './WorldMapView'

const frame: FrameSnapshot = {
  ts: 1730000000000,
  dayKey: '2026-01-15',
  stateSnapshot: {
    index: 6,
    risk: 5,
    volatility: 2,
    entropy: 1,
    drift: 0,
    stats: { strength: 5, intelligence: 6, wisdom: 5, dexterity: 5 },
    xp: 100,
    level: 4,
  },
  regimeSnapshot: {
    regimeId: 1,
    pCollapse: 0.2,
    sirenLevel: 'green',
    explainTop3: [],
    disarmProtocol: [],
  },
  goal: { goalScore: 2, gap: 0, explainTop3: [] },
  debt: { totalDebt: 10, trend: 'flat', protocol: [] },
  antifragility: { recoveryScore: 0.4, shockBudget: 0.3, antifragilityScore: 0.5 },
  forecastSummary: { p50next7: 6.2, confidence: 'высокая', coverage: 81 },
  tailRiskSummary: { pRed7d: 0.1, esCollapse10: 0.2 },
  multiverseSummary: { branches: [] },
  socialSummary: { topInfluencesWeek: [] },
  autopilotSummary: {},
}

const snapshot = buildWorldMapSnapshot(frame, 12, { width: 1100, height: 540, padding: 24 })

describe('WorldMapView', () => {
  it('renders deterministic snapshot content and stable ids', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(<WorldMapView snapshot={snapshot} />)
    })

    expect(container.querySelector('svg')).not.toBeNull()
    expect(container.querySelectorAll('circle[id^="svg-ring:"]').length).toBe(snapshot.rings.length)
    expect(container.querySelectorAll('g[id^="svg-planet:"]').length).toBe(snapshot.planets.length)
    expect(container.textContent).toContain('Ядро')
  })

  it('supports roving tabindex and keyboard selection', async () => {
    const onSelect = vi.fn<(id: string | null) => void>()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(<WorldMapView snapshot={snapshot} onPlanetSelect={onSelect} />)
    })

    const options = [...container.querySelectorAll<HTMLButtonElement>('.world-map__focus-point')]
    const active = options.find((button) => button.tabIndex === 0)
    expect(active).toBeDefined()
    expect(options.filter((button) => button.tabIndex === 0)).toHaveLength(1)

    active?.focus()
    await act(async () => {
      active?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })

    const nextActive = options.find((button) => button.tabIndex === 0)
    expect(nextActive).toBeDefined()
    expect(document.activeElement).toBe(nextActive)

    await act(async () => {
      nextActive?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(onSelect).toHaveBeenLastCalledWith(nextActive?.dataset.planetId)

    await act(async () => {
      nextActive?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(onSelect).toHaveBeenLastCalledWith(null)

    await act(async () => {
      root.unmount()
    })
    container.remove()
  })
})
