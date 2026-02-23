import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import type { WorldMapPlanet } from '../../core/worldMap/types'
import { advanceOrbitPhase, buildPlanetOrbitSpec, getOrbitVisualStylePreset, isFlagOn, orbitLocalPoint, relaxOrbitPhases, resolveOrbitVisualState } from './worldWebglOrbits'

const planet: WorldMapPlanet = {
  id: 'planet:alpha',
  domainId: 'core',
  order: 1,
  labelRu: 'Альфа',
  weight: 1,
  importance: 1,
  radius: 12,
  x: 350,
  y: 290,
  angle: 0.3,
  metrics: { level: 3, risk: 0.3, esCollapse10: 0.2, failProbability: 0.1, budgetPressure: 0.2, safeMode: false, sirenLevel: 'green' },
  renderHints: { hasStorm: false, stormStrength: 0, tailRisk: 0, drawTailGlow: false },
}

describe('worldWebglOrbits', () => {
  it('returns deterministic orbit parameters for same id + seed', () => {
    const first = buildPlanetOrbitSpec(planet, 77, planet.order, planet.radius * 0.042)
    const second = buildPlanetOrbitSpec(planet, 77, planet.order, planet.radius * 0.042)

    expect(first.phase).toBe(second.phase)
    expect(first.inclination).toBe(second.inclination)
    expect(first.nodeRotation).toBe(second.nodeRotation)
    expect(first.curve.xRadius).toBe(second.curve.xRadius)
    expect(first.curve.yRadius).toBe(second.curve.yRadius)
  })

  it('builds orbit ellipse centered at local origin', () => {
    const orbit = buildPlanetOrbitSpec(planet, 111, planet.order, planet.radius * 0.042)
    const bounds = new THREE.Box2().makeEmpty()
    orbit.curve.getSpacedPoints(192).forEach((point) => bounds.expandByPoint(point))
    const center = bounds.getCenter(new THREE.Vector2())

    expect(center.length()).toBeLessThan(1e-6)
  })

  it('relaxes phases deterministically', () => {
    const input = [
      { id: 'a', orbitRadius: 1.1, planetRadius: 0.22, phase: 0.1 },
      { id: 'b', orbitRadius: 1.2, planetRadius: 0.2, phase: 0.11 },
      { id: 'c', orbitRadius: 2.2, planetRadius: 0.3, phase: 0.8 },
    ]

    const first = relaxOrbitPhases(input)
    const second = relaxOrbitPhases(input)

    expect(first).toEqual(second)
  })

  it('keeps planet position exactly on orbit getPointAt value in local space', () => {
    const orbit = buildPlanetOrbitSpec(planet, 33, planet.order, planet.radius * 0.042)
    const phase = orbit.phase
    const local = orbitLocalPoint(orbit.curve, phase)
    const fromCurve = orbit.curve.getPointAt(phase)

    expect(local.distanceTo(new THREE.Vector3(fromCurve.x, 0, fromCurve.y))).toBeLessThan(1e-6)
  })



  it('advances phase only when drift is enabled', () => {
    expect(advanceOrbitPhase(0.2, 0.05, 1000, true)).toBeCloseTo(0.25)
    expect(advanceOrbitPhase(0.2, 0.05, 1000, false)).toBeCloseTo(0.2)
  })

  it('returns local-space curve points for orbit phases', () => {
    const orbit = buildPlanetOrbitSpec(planet, 33, planet.order, planet.radius * 0.042)
    const local = orbitLocalPoint(orbit.curve, 0.25)

    expect(local.y).toBe(0)
    expect(Number.isFinite(local.x)).toBe(true)
    expect(Number.isFinite(local.z)).toBe(true)
  })


  it('expands only first two orbits using core clearance rule', () => {
    const inner0 = buildPlanetOrbitSpec(planet, 10, 0, planet.radius * 0.042, 1, { coreRadius: 3.9, maxPlanetRadius: 0.8 })
    const inner1 = buildPlanetOrbitSpec(planet, 10, 1, planet.radius * 0.042, 1, { coreRadius: 3.9, maxPlanetRadius: 0.8 })
    const outer2 = buildPlanetOrbitSpec(planet, 10, 2, planet.radius * 0.042, 1, { coreRadius: 3.9, maxPlanetRadius: 0.8 })
    const minInnerRadius = 3.9 * 1.35 + 0.8 * 0.5 + 3.9 * 0.25

    expect(inner0.radiusHint).toBeGreaterThanOrEqual(minInnerRadius)
    expect(inner1.radiusHint).toBeGreaterThanOrEqual(minInnerRadius)
    expect(outer2.radiusHint).toBeLessThan(minInnerRadius)
  })

  it('keeps eccentricity and inclination within compact bounds', () => {
    const innerOrbit = buildPlanetOrbitSpec(planet, 27, 1, planet.radius * 0.042)
    const outerOrbit = buildPlanetOrbitSpec(planet, 91, 6, planet.radius * 0.042)

    expect((innerOrbit.curve.xRadius - innerOrbit.curve.yRadius) / innerOrbit.curve.xRadius).toBeLessThanOrEqual(0.2)
    expect(THREE.MathUtils.radToDeg(innerOrbit.inclination)).toBeLessThanOrEqual(8)
    expect(THREE.MathUtils.radToDeg(outerOrbit.inclination)).toBeLessThanOrEqual(14)
  })

  it('resolves orbit visual hierarchy for selected and dimmed non-selected orbits', () => {
    const style = getOrbitVisualStylePreset()
    expect(resolveOrbitVisualState(4, 4)).toEqual({
      opacity: style.selectedOrbit.opacity,
      lineWidth: style.baseLineWidth * style.selectedOrbit.lineWidthScale,
      colorMultiplier: style.selectedOrbit.colorMultiplier,
      glowOpacity: style.selectedOrbit.glowOpacity,
      blending: style.selectedOrbit.blending,
      glowVisible: style.selectedOrbit.glowVisible,
    })
    expect(resolveOrbitVisualState(1, 4)).toEqual({
      opacity: style.baseOrbit.opacity,
      lineWidth: style.baseLineWidth * style.baseOrbit.lineWidthScale,
      colorMultiplier: style.baseOrbit.colorMultiplier,
      glowOpacity: style.baseOrbit.glowOpacity,
      blending: style.baseOrbit.blending,
      glowVisible: style.baseOrbit.glowVisible,
    })
    expect(resolveOrbitVisualState(9, 4)).toEqual({
      opacity: style.baseOrbit.opacity,
      lineWidth: style.baseLineWidth * style.baseOrbit.lineWidthScale,
      colorMultiplier: style.baseOrbit.colorMultiplier,
      glowOpacity: style.baseOrbit.glowOpacity,
      blending: style.baseOrbit.blending,
      glowVisible: style.baseOrbit.glowVisible,
    })
  })

  it('keeps inner near orbits readable when nothing is selected', () => {
    const style = getOrbitVisualStylePreset()
    expect(resolveOrbitVisualState(2, null)).toEqual({
      opacity: style.nearOrbit.opacity,
      lineWidth: style.baseLineWidth * style.nearOrbit.lineWidthScale,
      colorMultiplier: style.nearOrbit.colorMultiplier,
      glowOpacity: style.nearOrbit.glowOpacity,
      blending: style.nearOrbit.blending,
      glowVisible: style.nearOrbit.glowVisible,
    })
    expect(resolveOrbitVisualState(5, null)).toEqual({
      opacity: style.baseOrbit.opacity,
      lineWidth: style.baseLineWidth * style.baseOrbit.lineWidthScale,
      colorMultiplier: style.baseOrbit.colorMultiplier,
      glowOpacity: style.baseOrbit.glowOpacity,
      blending: style.baseOrbit.blending,
      glowVisible: style.baseOrbit.glowVisible,
    })
  })


  it('treats 1 and true as enabled values for feature flags', () => {
    const originalLocalStorage = globalThis.localStorage
    const storage = new Map<string, string>()
    const fakeStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value) },
      removeItem: (key: string) => { storage.delete(key) },
      clear: () => { storage.clear() },
    }
    Object.defineProperty(globalThis, 'localStorage', { value: fakeStorage, configurable: true })

    globalThis.localStorage.setItem('worldOrbitDim', '1')
    expect(isFlagOn('worldOrbitDim')).toBe(true)
    globalThis.localStorage.setItem('worldOrbitDim', 'true')
    expect(isFlagOn('worldOrbitDim')).toBe(true)
    globalThis.localStorage.setItem('worldOrbitDim', '0')
    expect(isFlagOn('worldOrbitDim')).toBe(false)

    Object.defineProperty(globalThis, 'localStorage', { value: originalLocalStorage, configurable: true })
  })

  it('applies stronger dim preset when worldOrbitDim=1', () => {
    const originalLocalStorage = globalThis.localStorage
    const storage = new Map<string, string>()
    const fakeStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value) },
      removeItem: (key: string) => { storage.delete(key) },
      clear: () => { storage.clear() },
    }
    Object.defineProperty(globalThis, 'localStorage', { value: fakeStorage, configurable: true })
    globalThis.localStorage.setItem('worldOrbitDim', '1')
    const style = getOrbitVisualStylePreset()

    expect(style.baseOrbit.opacity).toBe(0.03)
    expect(style.baseOrbit.colorMultiplier).toBe(0.12)
    expect(style.baseOrbit.lineWidthScale).toBe(0.65)
    expect(style.baseOrbit.glowVisible).toBe(false)
    expect(style.selectedOrbit.opacity).toBe(0.85)
    expect(style.selectedOrbit.lineWidthScale).toBe(1.35)
    expect(style.selectedOrbit.glowVisible).toBe(true)

    globalThis.localStorage.removeItem('worldOrbitDim')
    Object.defineProperty(globalThis, 'localStorage', { value: originalLocalStorage, configurable: true })
  })

})
