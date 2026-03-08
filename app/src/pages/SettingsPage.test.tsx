/* @vitest-environment jsdom */
import { act } from 'react'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

describe('SettingsPage product settings', () => {
  beforeEach(() => {
    globalThis.localStorage.clear()
  })

  it('writes world settings from тонкая настройка темы', async () => {
    const { SettingsPage } = await import('./SettingsPage')

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <MemoryRouter>
          <SettingsPage
            onDataChanged={async () => undefined}
            appearance={{ theme: 'system', motion: 'normal', transparency: 'glass', worldUiVariant: 'instrument', worldRenderMode: 'webgl', worldLookPreset: 'clean', worldQuality: 'standard', uiPreset: 'clean', accentColor: 'auto', density: 'normal', fxEnabled: true, uiSoundEnabled: false, uiSoundVolume: 70 }}
            onAppearanceChange={() => undefined}
          />
        </MemoryRouter>,
      )
    })

    const advancedButton = [...container.querySelectorAll('button')].find((item) => item.textContent?.includes('Показать тонкую настройку темы'))
    await act(async () => {
      advancedButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    const selectiveBloomToggle = [...container.querySelectorAll('label')].find((item) => item.textContent?.includes('Выделять только активные орбиты'))?.querySelector('input[type="checkbox"]')
    await act(async () => {
      selectiveBloomToggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(globalThis.localStorage.getItem('worldSelectiveBloom')).toBe('1')

    await act(async () => { root.unmount() })
    container.remove()
  })

  it('shows тонкая настройка темы in профи mode', async () => {
    const { SettingsPage } = await import('./SettingsPage')

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <MemoryRouter>
          <SettingsPage
            onDataChanged={async () => undefined}
            appearance={{ theme: 'system', motion: 'normal', transparency: 'glass', worldUiVariant: 'instrument', worldRenderMode: 'webgl', worldLookPreset: 'clean', worldQuality: 'standard', uiPreset: 'clean', accentColor: 'auto', density: 'normal', fxEnabled: true, uiSoundEnabled: false, uiSoundVolume: 70 }}
            onAppearanceChange={() => undefined}
          />
        </MemoryRouter>,
      )
    })

    expect(container.textContent?.includes('Скорость анимации')).toBe(false)

    const proButton = [...container.querySelectorAll('button')].find((item) => item.textContent?.includes('Профи'))
    await act(async () => {
      proButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(container.textContent?.includes('Скорость анимации')).toBe(true)

    await act(async () => { root.unmount() })
    container.remove()
  })
})
