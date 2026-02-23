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

  it('does not enable worldDebugHUD when legacy keys are disabled', async () => {
    window.localStorage.setItem('worldDebugOrbits', '0')
    window.localStorage.setItem('worldDebugLighting', 'false')

    const { readWorldDebugHUDFlag } = await import('./worldDebugHUD')

    expect(readWorldDebugHUDFlag()).toBe(false)
    expect(window.localStorage.getItem('worldDebugHUD')).toBeNull()
    expect(window.localStorage.getItem('worldDebugOrbits')).toBeNull()
    expect(window.localStorage.getItem('worldDebugLighting')).toBeNull()
  })
})
