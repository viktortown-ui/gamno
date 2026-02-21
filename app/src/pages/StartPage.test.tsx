/* @vitest-environment jsdom */
import { act } from 'react'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { HashRouter } from 'react-router-dom'

const navigateMock = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigateMock }
})

vi.mock('../core/workers/worldMapClient', () => ({
  createWorldMapWorker: vi.fn((onMessage: (message: unknown) => void) => ({ terminate: vi.fn(), _onMessage: onMessage })),
  runWorldMapInWorker: vi.fn((worker: { _onMessage: (message: unknown) => void }) => {
    worker._onMessage({
      type: 'done',
      result: {
        id: 'snapshot:start',
        ts: 1,
        seed: 12,
        viewport: { width: 800, height: 600, padding: 24 },
        center: { x: 400, y: 300 },
        metrics: { level: 1, risk: 0.1, esCollapse10: 0.1, failProbability: 0.1, budgetPressure: 0.1, safeMode: false, sirenLevel: 'green' },
        rings: [],
        storms: [],
        domains: [],
        planets: [],
      },
    })
  }),
}))

vi.mock('../ui/components/WorldMapView', () => ({ WorldMapView: () => <div>PREVIEW</div> }))

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('StartPage', () => {
  it('has reduced motion flag and CTA navigation', async () => {
    Object.defineProperty(window, 'matchMedia', { value: () => ({ matches: true, addEventListener: () => undefined, removeEventListener: () => undefined }), configurable: true })
    const { StartPage } = await import('./StartPage')
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <HashRouter>
          <StartPage onDone={async () => undefined} hintsEnabled={false} onHintsChange={() => undefined} />
        </HashRouter>,
      )
    })
    await act(async () => { await flush() })

    expect(container.querySelector('.start-hero')?.getAttribute('data-reduced-motion')).toBe('true')

    const buttons = [...container.querySelectorAll('button')]
    const primary = buttons.find((item) => item.textContent?.includes('Сделать первый чек-ин'))
    const secondary = buttons.find((item) => item.textContent?.includes('Открыть Мир'))
    primary?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    secondary?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(navigateMock).toHaveBeenCalledWith('/core')
    expect(navigateMock).toHaveBeenCalledWith('/world')

    await act(async () => { root.unmount() })
    container.remove()
  })
})
