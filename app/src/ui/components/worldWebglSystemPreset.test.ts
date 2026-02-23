/* @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest'
import { getWorldSystemPresetSpec, readWorldSystemPreset } from './worldWebglSystemPreset'

describe('worldWebglSystemPreset', () => {
  afterEach(() => {
    window.localStorage.clear()
  })

  it('uses normal preset by default', () => {
    expect(readWorldSystemPreset()).toBe('normal')
    expect(getWorldSystemPresetSpec().orbitRadiusScale).toBe(1)
    expect(getWorldSystemPresetSpec().maxOrbitRadius).toBe(Number.POSITIVE_INFINITY)
  })

  it('reads compact preset from localStorage', () => {
    window.localStorage.setItem('worldSystemPreset', 'compact')
    expect(readWorldSystemPreset()).toBe('compact')
    expect(getWorldSystemPresetSpec()).toEqual({
      orbitRadiusScale: 0.75,
      maxOrbitRadius: 7.4,
      innerInclinationMaxDeg: 6,
      outerInclinationMaxDeg: 10,
    })
  })
})
