/* @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  vi.resetModules()
  window.localStorage.clear()
})

describe('worldDebugHUD helpers', () => {
  it('migrates legacy debug flags into worldDebugHUD once and removes old keys', async () => {
    window.localStorage.setItem('worldDebugOrbits', '1')
    window.localStorage.setItem('worldDebugLighting', '0')

    const { readWorldDebugHUDFlag } = await import('./worldDebugHUD')

    expect(readWorldDebugHUDFlag()).toBe(true)
    expect(window.localStorage.getItem('worldDebugHUD')).toBe('1')
    expect(window.localStorage.getItem('worldDebugOrbits')).toBeNull()
    expect(window.localStorage.getItem('worldDebugLighting')).toBeNull()
  })

  it('migrates regex-matched legacy HUD keys into worldDebugHUD and removes them', async () => {
    window.localStorage.setItem('worldLegacyHudDebug', 'true')

    const { readWorldDebugHUDFlag } = await import('./worldDebugHUD')

    expect(readWorldDebugHUDFlag()).toBe(true)
    expect(window.localStorage.getItem('worldDebugHUD')).toBe('1')
    expect(window.localStorage.getItem('worldLegacyHudDebug')).toBeNull()
  })

  it('does not enable worldDebugHUD when legacy keys are disabled', async () => {
    window.localStorage.setItem('worldDebugOrbits', '0')
    window.localStorage.setItem('worldDebugLighting', 'false')

    const { readWorldDebugHUDFlag } = await import('./worldDebugHUD')

    expect(readWorldDebugHUDFlag()).toBe(false)
    expect(window.localStorage.getItem('worldDebugHUD')).toBeNull()
    expect(window.localStorage.getItem('worldDebugOrbits')).toBeNull()
    expect(window.localStorage.getItem('worldDebugLighting')).toBeNull()
  })

  it('keeps HUD invisible when worldDebugHUD is off even if OrbitDim is on', async () => {
    window.localStorage.setItem('worldOrbitDim', '1')
    const { resolveWorldShowHud } = await import('./worldDebugHUD')

    expect(resolveWorldShowHud({ isDev: true, worldDebugHUD: false, worldDeveloper: true })).toBe(false)
  })

  it('keeps HUD hidden in production without worldDeveloper override', async () => {
    const { resolveWorldDebugHUDVisibility } = await import('./worldDebugHUD')

    expect(resolveWorldDebugHUDVisibility({ isDev: false, worldDebugHUD: true, worldDeveloper: false })).toBe(false)
    expect(resolveWorldDebugHUDVisibility({ isDev: false, worldDebugHUD: true, worldDeveloper: true })).toBe(true)
  })
})
