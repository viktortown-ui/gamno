import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import type { WorldMapPlanet } from '../../core/worldMap/types'
import { advanceOrbitPhase, buildPlanetOrbitSpec, orbitLocalPoint, relaxOrbitPhases } from './worldWebglOrbits'

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
      { id: 'a', orbitRadius: 1.1, phase: 0.1 },
      { id: 'b', orbitRadius: 1.2, phase: 0.11 },
      { id: 'c', orbitRadius: 2.2, phase: 0.8 },
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
})
