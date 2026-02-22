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
  curve: THREE.EllipseCurve
  inclination: number
  nodeRotation: number
  yOffset: number
  phase: number
  speed: number
  radiusHint: number
  pointAt: (phase: number, out?: THREE.Vector3) => THREE.Vector3
}

export function orbitLocalPoint(curve: THREE.EllipseCurve, phase: number, out = new THREE.Vector3()): THREE.Vector3 {
  const p = curve.getPointAt(phase)
  return out.set(p.x, 0, p.y)
}

export interface OrbitPhaseInput {
  id: string
  orbitRadius: number
  phase: number
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

export function relaxOrbitPhases(entries: OrbitPhaseInput[], minSep = 0.3, iterations = 8): OrbitPhaseInput[] {
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
        if (distance >= minSep) continue
        const correction = (minSep - distance) * 0.5
        const direction = delta >= 0 ? 1 : -1
        a.phase = normalizeAngle(a.phase + correction * direction)
        b.phase = normalizeAngle(b.phase - correction * direction)
      }
    }
  }

  return relaxed
}

export function buildPlanetOrbitSpec(planet: WorldMapPlanet, seed: number, basePosition: THREE.Vector3, meshRadius: number): OrbitSpec {
  const hash = hashString(`${planet.id}:${seed}:orbit`)
  const eccentricity = 0.72 + hashToUnit(hash ^ 0x9e3779b9) * 0.2
  const clearance = meshRadius * (1.5 + hashToUnit(hash ^ 0x85ebca6b) * 0.3) + 0.035
  const semiMajor = Math.max(0.48, Math.abs(basePosition.x) + clearance)
  const semiMinor = Math.max(0.44, Math.abs(basePosition.z) + clearance) * eccentricity
  const inclination = (hashToUnit(hash ^ 0xc2b2ae35) - 0.5) * 0.5
  const nodeRotation = hashToUnit(hash ^ 0x27d4eb2f) * TWO_PI
  const phase = hashToUnit(hash ^ 0x165667b1)
  const speed = 0.014 + hashToUnit(hash ^ 0xd3a2646c) * 0.018
  const curve = new THREE.EllipseCurve(0, 0, semiMajor, semiMinor, 0, TWO_PI, false, 0)
  const pointAt = (nextPhase: number, out = new THREE.Vector3()): THREE.Vector3 => {
    orbitLocalPoint(curve, nextPhase, out)
    out.applyAxisAngle(new THREE.Vector3(1, 0, 0), inclination)
    out.applyAxisAngle(new THREE.Vector3(0, 1, 0), nodeRotation)
    out.y += basePosition.y
    return out
  }

  return {
    id: planet.id,
    curve,
    inclination,
    nodeRotation,
    yOffset: basePosition.y,
    phase,
    speed,
    radiusHint: Math.max(semiMajor, semiMinor),
    pointAt,
  }
}
