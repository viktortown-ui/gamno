import { describe, expect, it } from 'vitest'
import { needsLaunchOnboarding } from './core/frame/launchGate'

describe('launch gating', () => {
  it('открывает запуск при пустых данных', () => {
    expect(needsLaunchOnboarding(0, false)).toBe(true)
    expect(needsLaunchOnboarding(2, true)).toBe(true)
    expect(needsLaunchOnboarding(3, true)).toBe(false)
  })
})
