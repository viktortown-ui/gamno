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

vi.mock('../core/storage/repo', () => ({
  listCheckins: vi.fn(async () => []),
  seedTestData: vi.fn(async () => undefined),
}))

HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as typeof HTMLCanvasElement.prototype.getContext

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('StartPage', () => {
  it('offers optional help page actions', async () => {
    const { StartPage } = await import('./StartPage')
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <HashRouter>
          <StartPage onDone={async () => undefined} hintsEnabled={false} onHintsChange={() => undefined} uiPreset="clean" worldLookPreset="clean" />
        </HashRouter>,
      )
    })
    await act(async () => { await flush() })

    const buttons = [...container.querySelectorAll('button')]
    buttons.find((item) => item.textContent?.includes('Открыть Мир'))?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    buttons.find((item) => item.textContent?.includes('Первый чек-ин'))?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(navigateMock).toHaveBeenCalledWith('/world')
    expect(navigateMock).toHaveBeenCalledWith('/core')

    await act(async () => { root.unmount() })
    container.remove()
  })
})
