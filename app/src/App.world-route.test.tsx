/* @vitest-environment jsdom */
import { act } from 'react'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { HashRouter } from 'react-router-dom'

Object.defineProperty(window, 'innerWidth', { value: 1300, configurable: true })
Object.defineProperty(window, 'matchMedia', { value: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }), configurable: true })

vi.mock('./pages/WorldPage', () => ({ WorldPage: () => <div data-testid="world-page">WORLD</div> }))
vi.mock('./pages/StartPage', () => ({ StartPage: () => <div data-testid="start-page">START</div> }))
vi.mock('./repo/frameRepo', () => ({ getLastFrame: vi.fn(async () => ({ payload: { stateSnapshot: { index: 0, risk: 0, volatility: 0 }, forecastSummary: { p50next7: 0, confidence: 'низкая' }, regimeSnapshot: { explainTop3: [], regimeId: 0, pCollapse: 0, sirenLevel: 'green' }, goal: { goalScore: 0, gap: 0 }, tailRiskSummary: { pRed7d: 0 }, debt: { totalDebt: 0, trend: 'flat' }, socialSummary: { topInfluencesWeek: [] }, autopilotSummary: {}, antifragility: { recoveryScore: 0 } } })), computeAndSaveFrame: vi.fn(async () => ({ payload: { stateSnapshot: { index: 0, risk: 0, volatility: 0 }, forecastSummary: { p50next7: 0, confidence: 'низкая' }, regimeSnapshot: { explainTop3: [], regimeId: 0, pCollapse: 0, sirenLevel: 'green' }, goal: { goalScore: 0, gap: 0 }, tailRiskSummary: { pRed7d: 0 }, debt: { totalDebt: 0, trend: 'flat' }, socialSummary: { topInfluencesWeek: [] }, autopilotSummary: {}, antifragility: { recoveryScore: 0 } } })) }))
vi.mock('./core/storage/repo', () => ({ listCheckins: vi.fn(async () => [1, 2, 3]), getLatestCheckin: vi.fn(async () => undefined), getActiveQuest: vi.fn(async () => undefined) }))

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('App world routes', () => {
  beforeEach(() => {
    window.localStorage.setItem('hasSeenStart', '1')
  })

  it('renders /world route directly', async () => {
    window.location.hash = '#/world'
    const { default: App } = await import('./App')
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => { root.render(<HashRouter><App /></HashRouter>) })
    await act(async () => { await flush() })

    expect(container.textContent).toContain('WORLD')

    await act(async () => { root.unmount() })
    container.remove()
  })

  it('first visit routes to /start', async () => {
    window.localStorage.removeItem('hasSeenStart')
    window.location.hash = '#/world'
    const { default: App } = await import('./App')
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => { root.render(<HashRouter><App /></HashRouter>) })
    await act(async () => { await flush() })

    expect(container.textContent).toContain('START')

    await act(async () => { root.unmount() })
    container.remove()
  })
})
