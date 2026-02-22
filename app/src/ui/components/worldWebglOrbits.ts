import * as THREE from 'three'
import type { WorldMapPlanet } from '../../core/worldMap/types'

const TWO_PI = Math.PI * 2

function hashString(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function hashToUnit(seed: number): number {
  let x = seed + 0x6d2b79f5
  x = Math.imul(x ^ (x >>> 15), 1 | x)
  x ^= x + Math.imul(x ^ (x >>> 7), 61 | x)
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296
}

export interface OrbitSpec {
  id: string
  orbitIndex: number
  curve: THREE.EllipseCurve
  inclination: number
  nodeRotation: number
  phase: number
  speed: number
  radiusHint: number
}

export function orbitLocalPoint(curve: THREE.EllipseCurve, phase: number, out = new THREE.Vector3()): THREE.Vector3 {
  const p = curve.getPointAt(phase)
  return out.set(p.x, 0, p.y)
}


export function advanceOrbitPhase(currentPhase: number, speed: number, deltaMs: number, enabled: boolean): number {
  if (!enabled) return currentPhase
  const next = currentPhase + speed * (deltaMs * 0.001)
  return ((next % 1) + 1) % 1
}

export interface OrbitPhaseInput {
  id: string
  orbitRadius: number
  planetRadius: number
  phase: number
}

export interface OrbitVisualState {
  opacity: number
  lineWidth: number
}

export function resolveOrbitVisualState(
  orbitIndex: number,
  selectedOrbitIndex: number | null,
): OrbitVisualState {
  if (selectedOrbitIndex == null) {
    return { opacity: 0.14, lineWidth: 1.2 }
  }

  if (orbitIndex === selectedOrbitIndex) {
    return { opacity: 0.86, lineWidth: 1.5 }
  }

  if (Math.abs(orbitIndex - selectedOrbitIndex) === 1) {
    return { opacity: 0.32, lineWidth: 1.25 }
  }

  return { opacity: 0.12, lineWidth: 1.1 }
}

function shortestAngleDelta(a: number, b: number): number {
  let delta = (a - b) % TWO_PI
  if (delta > Math.PI) delta -= TWO_PI
  if (delta < -Math.PI) delta += TWO_PI
  return delta
}

function normalizeAngle(angle: number): number {
  let next = angle % TWO_PI
  if (next < 0) next += TWO_PI
  return next
}

export function relaxOrbitPhases(entries: OrbitPhaseInput[], minSep = 0.3, iterations = 8, minSeparationScale = 1): OrbitPhaseInput[] {
  const relaxed = entries
    .map((entry) => ({ ...entry, phase: normalizeAngle(entry.phase) }))
    .sort((a, b) => (a.orbitRadius - b.orbitRadius) || a.id.localeCompare(b.id))

  for (let i = 0; i < iterations; i += 1) {
    for (let left = 0; left < relaxed.length; left += 1) {
      for (let right = left + 1; right < relaxed.length; right += 1) {
        const a = relaxed[left]
        const b = relaxed[right]
        const radiusDelta = Math.abs(a.orbitRadius - b.orbitRadius)
        if (radiusDelta > 0.35) continue
        const delta = shortestAngleDelta(a.phase, b.phase)
        const distance = Math.abs(delta)
        const minRadius = Math.max(0.001, Math.min(a.orbitRadius, b.orbitRadius))
        const linearSep = ((a.planetRadius + b.planetRadius) / minRadius) * minSeparationScale
        const minSepForPair = Math.max(minSep, linearSep)
        if (distance >= minSepForPair) continue
        const correction = (minSepForPair - distance) * 0.5
        const direction = delta >= 0 ? 1 : -1
        a.phase = normalizeAngle(a.phase + correction * direction)
        b.phase = normalizeAngle(b.phase - correction * direction)
      }
    }
  }

  return relaxed
}

export function buildPlanetOrbitSpec(
  planet: WorldMapPlanet,
  seed: number,
  orbitIndex: number,
  meshRadius: number,
  orbitRadiusScale = 1,
): OrbitSpec {
  const hash = hashString(`${planet.id}:${seed}:orbit`)
  const index = Math.max(0, orbitIndex)
  const semiMajorBase = (1.9 + index * 0.63) * orbitRadiusScale
  const semiMajor = semiMajorBase + hashToUnit(hash ^ 0x85ebca6b) * 0.16 + meshRadius * 0.7
  const eccentricity = hashToUnit(hash ^ 0x9e3779b9) * 0.2
  const semiMinor = semiMajor * (1 - eccentricity)
  const inclinationCap = index <= 2 ? 8 : 14
  const inclinationDeg = hashToUnit(hash ^ 0xc2b2ae35) * inclinationCap
  const inclination = THREE.MathUtils.degToRad(inclinationDeg)
  const nodeRotation = hashToUnit(hash ^ 0x27d4eb2f) * TWO_PI
  const phase = hashToUnit(hash ^ 0x165667b1)
  const speedBase = 0.028 / Math.sqrt(1 + index * 0.6)
  const speed = speedBase * (0.88 + hashToUnit(hash ^ 0xd3a2646c) * 0.24)
  const curve = new THREE.EllipseCurve(0, 0, semiMajor, semiMinor, 0, TWO_PI, false, 0)

  return {
    id: planet.id,
    orbitIndex: index,
    curve,
    inclination,
    nodeRotation,
    phase,
    speed,
    radiusHint: Math.max(semiMajor, semiMinor),
  }
}
