/* @vitest-environment jsdom */
import { act } from 'react'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HashRouter } from 'react-router-dom'

Object.defineProperty(window, 'innerWidth', { value: 1300, configurable: true })
Object.defineProperty(window, 'matchMedia', { value: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }), configurable: true })

vi.mock('./pages/WorldPage', () => ({ WorldPage: () => <div data-testid="world-page">WORLD</div> }))
vi.mock('./pages/StartPage', () => ({ StartPage: () => <div data-testid="start-page">START</div> }))
vi.mock('./pages/CorePage', () => ({ CorePage: () => <div data-testid="core-page">CORE</div> }))
vi.mock('./pages/DashboardPage', () => ({ DashboardPage: () => <div data-testid="dashboard-page">DASHBOARD</div> }))
vi.mock('./pages/HistoryPage', () => ({ HistoryPage: () => <div>HISTORY</div> }))
vi.mock('./pages/SettingsPage', () => ({ SettingsPage: () => <div>SETTINGS</div> }))
vi.mock('./pages/OraclePage', () => ({ OraclePage: () => <div>ORACLE</div> }))
vi.mock('./pages/GraphPage', () => ({ GraphPage: () => <div>GRAPH</div> }))
vi.mock('./pages/GoalsPage', () => ({ GoalsPage: () => <div>GOALS</div> }))
vi.mock('./pages/MultiversePage', () => ({ MultiversePage: () => <div>MULTIVERSE</div> }))
vi.mock('./pages/BlackSwansPage', () => ({ BlackSwansPage: () => <div>BLACK SWANS</div> }))
vi.mock('./pages/SocialRadarPage', () => ({ SocialRadarPage: () => <div>SOCIAL RADAR</div> }))
vi.mock('./pages/TimeDebtPage', () => ({ TimeDebtPage: () => <div>TIME DEBT</div> }))
vi.mock('./pages/AutopilotPage', () => ({ AutopilotPage: () => <div>AUTOPILOT</div> }))
vi.mock('./pages/AntifragilityPage', () => ({ AntifragilityPage: () => <div>ANTIFRAGILITY</div> }))
vi.mock('./pages/SystemPage', () => ({ SystemPage: () => <div>SYSTEM</div> }))
vi.mock('./repo/frameRepo', () => ({ getLastFrame: vi.fn(async () => ({ payload: { stateSnapshot: { index: 0, risk: 0, volatility: 0 }, forecastSummary: { p50next7: 0, confidence: 'низкая' }, regimeSnapshot: { explainTop3: [], regimeId: 0, pCollapse: 0, sirenLevel: 'green' }, goal: { goalScore: 0, gap: 0 }, tailRiskSummary: { pRed7d: 0 }, debt: { totalDebt: 0, trend: 'flat' }, socialSummary: { topInfluencesWeek: [] }, autopilotSummary: {}, antifragility: { recoveryScore: 0 } } })), computeAndSaveFrame: vi.fn(async () => ({ payload: { stateSnapshot: { index: 0, risk: 0, volatility: 0 }, forecastSummary: { p50next7: 0, confidence: 'низкая' }, regimeSnapshot: { explainTop3: [], regimeId: 0, pCollapse: 0, sirenLevel: 'green' }, goal: { goalScore: 0, gap: 0 }, tailRiskSummary: { pRed7d: 0 }, debt: { totalDebt: 0, trend: 'flat' }, socialSummary: { topInfluencesWeek: [] }, autopilotSummary: {}, antifragility: { recoveryScore: 0 } } })) }))
vi.mock('./core/storage/repo', () => ({ listCheckins: vi.fn(async () => []), getLatestCheckin: vi.fn(async () => undefined), getActiveQuest: vi.fn(async () => undefined) }))

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('navigation rail', () => {
  beforeEach(() => {
    window.localStorage.setItem('hasSeenStart', '1')
    window.location.hash = '#/world'
  })

  async function renderApp() {
    const { default: App } = await import('./App')
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => { root.render(<HashRouter><App /></HashRouter>) })
    await act(async () => { await flush() })

    return { container, root }
  }

  it('renders rail container', async () => {
    const { container, root } = await renderApp()

    expect(container.querySelector('[data-testid="navigation-rail"]')).not.toBeNull()

    await act(async () => { root.unmount() })
    container.remove()
  })

  it('shows labels in expanded mode', async () => {
    const { container, root } = await renderApp()

    expect(container.textContent).toContain('Приветствие / Старт')
    expect(container.textContent).toContain('Мир')

    await act(async () => { root.unmount() })
    container.remove()
  })

  it('adds tooltip titles in collapsed mode', async () => {
    const { container, root } = await renderApp()

    const toggle = container.querySelector('.sidebar__toggle') as HTMLButtonElement
    await act(async () => {
      toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    const worldLink = container.querySelector('a[href="#/world"]') as HTMLAnchorElement
    expect(worldLink.getAttribute('title')).toBe('Мир')

    await act(async () => { root.unmount() })
    container.remove()
  })


  it('opens More popover with grouped items and search', async () => {
    const { container, root } = await renderApp()

    const moreButton = container.querySelector('.nav-more .nav-link--button') as HTMLButtonElement
    await act(async () => {
      moreButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(container.textContent).toContain('Модули')
    expect(container.textContent).toContain('Сервис')

    const searchInput = container.querySelector('.nav-more__search') as HTMLInputElement
    await act(async () => {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
      descriptor?.set?.call(searchInput, 'сист')
      searchInput.dispatchEvent(new Event('input', { bubbles: true }))
    })

    const filteredLinks = Array.from(container.querySelectorAll('.nav-more__popover .nav-link__label')).map((node) => node.textContent)
    expect(filteredLinks).toContain('Система')
    expect(filteredLinks).not.toContain('Автопилот')

    await act(async () => { root.unmount() })
    container.remove()
  })

  it('toggles sidebar with keyboard shortcut', async () => {
    const { container, root } = await renderApp()

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '[', bubbles: true }))
    })

    expect(container.querySelector('.layout')?.className).toContain('layout--sidebar-collapsed')

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '[', bubbles: true }))
    })

    expect(container.querySelector('.layout')?.className).not.toContain('layout--sidebar-collapsed')

    await act(async () => { root.unmount() })
    container.remove()
  })

  it('changes route on nav click', async () => {
    const { container, root } = await renderApp()

    const dashboardLink = container.querySelector('a[href="#/dashboard"]') as HTMLAnchorElement
    await act(async () => {
      dashboardLink.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flush()
    })

    expect(window.location.hash).toBe('#/dashboard')
    expect(container.textContent).toContain('DASHBOARD')

    await act(async () => { root.unmount() })
    container.remove()
  })
})
