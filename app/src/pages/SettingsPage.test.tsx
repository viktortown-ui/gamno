/* @vitest-environment jsdom */
import { act } from 'react'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('SettingsPage debug panel', () => {
  it('writes world debug settings to localStorage on apply', async () => {
    const { SettingsPage } = await import('./SettingsPage')
    const reloadSpy = vi.fn()
    const originalLocation = window.location
    Reflect.deleteProperty(window, 'location')
    Object.defineProperty(window, 'location', {
      value: { ...originalLocation, reload: reloadSpy },
      configurable: true,
    })

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <SettingsPage
          onDataChanged={async () => undefined}
          appearance={{ theme: 'dark', motion: 'normal', transparency: 'glass', worldUiVariant: 'instrument', worldRenderMode: 'webgl' }}
          onAppearanceChange={() => undefined}
        />,
      )
    })
    await act(async () => { await flush() })

    const toggles = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
    const orbitDimToggle = toggles.find((item) => item.parentElement?.textContent?.includes('worldOrbitDim'))
    const selectiveBloomToggle = toggles.find((item) => item.parentElement?.textContent?.includes('worldSelectiveBloom'))
    const showAllOrbitsToggle = toggles.find((item) => item.parentElement?.textContent?.includes('worldShowAllOrbits'))
    const debugHudToggle = toggles.find((item) => item.parentElement?.textContent?.includes('worldDebugHUD'))

    await act(async () => {
      orbitDimToggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      selectiveBloomToggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      showAllOrbitsToggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      debugHudToggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    const selects = [...container.querySelectorAll<HTMLSelectElement>('select')]
    const bloomPreset = selects.find((item) => item.parentElement?.textContent?.includes('worldBloomPreset'))
    const systemPreset = selects.find((item) => item.parentElement?.textContent?.includes('worldSystemPreset'))
    if (!bloomPreset) throw new Error('Bloom preset select not found')
    if (!systemPreset) throw new Error('System preset select not found')
    await act(async () => {
      bloomPreset.value = 'hot'
      bloomPreset.dispatchEvent(new Event('change', { bubbles: true }))
      systemPreset.value = 'compact'
      systemPreset.dispatchEvent(new Event('change', { bubbles: true }))
    })

    const applyButton = [...container.querySelectorAll('button')].find((item) => item.textContent?.includes('Применить и перезагрузить'))
    await act(async () => {
      applyButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(globalThis.localStorage.getItem('worldOrbitDim')).toBe('1')
    expect(globalThis.localStorage.getItem('worldSelectiveBloom')).toBe('1')
    expect(globalThis.localStorage.getItem('worldShowAllOrbits')).toBe('1')
    expect(globalThis.localStorage.getItem('worldBloomPreset')).toBe('hot')
    expect(globalThis.localStorage.getItem('worldSystemPreset')).toBe('compact')
    expect(globalThis.localStorage.getItem('worldDebugHUD')).toBe('1')
    expect(reloadSpy).toHaveBeenCalledTimes(1)

    await act(async () => { root.unmount() })
    container.remove()

    Object.defineProperty(window, 'location', {
      value: originalLocation,
      configurable: true,
    })
  })
})
