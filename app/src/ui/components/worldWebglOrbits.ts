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
  colorMultiplier: number
  glowOpacity: number
  blending: THREE.Blending
  glowVisible: boolean
}

export interface OrbitStyleSpec {
  opacity: number
  lineWidthScale: number
  colorMultiplier: number
  glowOpacity: number
  blending: THREE.Blending
  glowVisible: boolean
}

export interface OrbitVisualStylePreset {
  baseLineWidth: number
  baseOrbit: OrbitStyleSpec
  nearOrbit: OrbitStyleSpec
  selectedOrbit: OrbitStyleSpec
}

export function isFlagOn(key: string): boolean {
  const raw = globalThis.localStorage?.getItem(key)?.trim().toLowerCase()
  return raw === '1' || raw === 'true'
}

const ORBIT_VISUAL_STYLE_DEFAULT: OrbitVisualStylePreset = {
  baseLineWidth: 0.77,
  baseOrbit: { opacity: 0.08, lineWidthScale: 1, colorMultiplier: 1, glowOpacity: 0, blending: THREE.NormalBlending, glowVisible: false },
  nearOrbit: { opacity: 0.14, lineWidthScale: 1.2, colorMultiplier: 1, glowOpacity: 0.04, blending: THREE.NormalBlending, glowVisible: true },
  selectedOrbit: { opacity: 0.82, lineWidthScale: 1.56, colorMultiplier: 1, glowOpacity: 0.12, blending: THREE.AdditiveBlending, glowVisible: true },
}

const ORBIT_VISUAL_STYLE_HARD_DIM: OrbitVisualStylePreset = {
  baseLineWidth: 0.77,
  baseOrbit: { opacity: 0.03, lineWidthScale: 0.65, colorMultiplier: 0.12, glowOpacity: 0, blending: THREE.NormalBlending, glowVisible: false },
  nearOrbit: { opacity: 0.03, lineWidthScale: 0.65, colorMultiplier: 0.12, glowOpacity: 0, blending: THREE.NormalBlending, glowVisible: false },
  selectedOrbit: { opacity: 0.85, lineWidthScale: 1.35, colorMultiplier: 1, glowOpacity: 0.22, blending: THREE.AdditiveBlending, glowVisible: true },
}

function isHardOrbitDimEnabled(): boolean {
  return isFlagOn('worldOrbitDim')
}

export function getOrbitVisualStylePreset(): OrbitVisualStylePreset {
  return isHardOrbitDimEnabled() ? ORBIT_VISUAL_STYLE_HARD_DIM : ORBIT_VISUAL_STYLE_DEFAULT
}

export function resolveOrbitVisualState(
  orbitIndex: number,
  selectedOrbitIndex: number | null,
): OrbitVisualState {
  const style = getOrbitVisualStylePreset()
  const asVisual = (spec: OrbitStyleSpec): OrbitVisualState => ({
    opacity: spec.opacity,
    lineWidth: style.baseLineWidth * spec.lineWidthScale,
    colorMultiplier: spec.colorMultiplier,
    glowOpacity: spec.glowOpacity,
    blending: spec.blending,
    glowVisible: spec.glowVisible,
  })

  if (selectedOrbitIndex == null) {
    if (orbitIndex <= 2) {
      return asVisual(style.nearOrbit)
    }
    return asVisual(style.baseOrbit)
  }

  if (orbitIndex === selectedOrbitIndex) {
    return asVisual(style.selectedOrbit)
  }

  return asVisual(style.baseOrbit)
}

export interface InnerOrbitLayoutInput {
  coreRadius: number
  maxPlanetRadius: number
  clearance?: number
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
  innerOrbitLayout?: InnerOrbitLayoutInput,
): OrbitSpec {
  const hash = hashString(`${planet.id}:${seed}:orbit`)
  const index = Math.max(0, orbitIndex)
  const semiMajorBase = (1.9 + index * 0.63) * orbitRadiusScale
  const semiMajorRaw = semiMajorBase + hashToUnit(hash ^ 0x85ebca6b) * 0.16 + meshRadius * 0.7
  const eccentricity = hashToUnit(hash ^ 0x9e3779b9) * 0.2
  const clearance = innerOrbitLayout?.clearance ?? (innerOrbitLayout ? innerOrbitLayout.coreRadius * 0.25 : 0)
  const minInnerRadius = innerOrbitLayout
    ? innerOrbitLayout.coreRadius * 1.35 + innerOrbitLayout.maxPlanetRadius * 0.5 + clearance
    : 0
  const constrainedInnerRadius = index <= 1 ? minInnerRadius : 0
  const semiMajor = Math.max(semiMajorRaw, constrainedInnerRadius)
  const semiMinor = Math.max(semiMajor * (1 - eccentricity), constrainedInnerRadius)
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
