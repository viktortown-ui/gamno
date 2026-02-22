import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import type { WorldMapPlanet } from '../../core/worldMap/types'
import { buildPlanetOrbitSpec, orbitLocalPoint, relaxOrbitPhases } from './worldWebglOrbits'

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
    const base = new THREE.Vector3(1.4, -0.2, 1.1)
    const first = buildPlanetOrbitSpec(planet, 77, base, planet.radius * 0.042)
    const second = buildPlanetOrbitSpec(planet, 77, base, planet.radius * 0.042)

    expect(first.phase).toBe(second.phase)
    expect(first.inclination).toBe(second.inclination)
    expect(first.nodeRotation).toBe(second.nodeRotation)
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

  it('keeps planet position exactly on orbit point for phase', () => {
    const base = new THREE.Vector3(1.3, 0.4, 1)
    const orbit = buildPlanetOrbitSpec(planet, 33, base, planet.radius * 0.042)
    const pos = orbit.pointAt(orbit.phase)
    const expected = orbit.pointAt(orbit.phase)

    expect(pos.distanceTo(expected)).toBeLessThan(1e-6)
  })

  it('returns local-space curve points for orbit phases', () => {
    const base = new THREE.Vector3(1.3, 0.4, 1)
    const orbit = buildPlanetOrbitSpec(planet, 33, base, planet.radius * 0.042)
    const local = orbitLocalPoint(orbit.curve, 0.25)

    expect(local.y).toBe(0)
    expect(Number.isFinite(local.x)).toBe(true)
    expect(Number.isFinite(local.z)).toBe(true)
  })
})
