import * as THREE from 'three'
import type { WorldMapPlanet, WorldMapSnapshot } from '../../core/worldMap/types'
import { getWorldScaleSpec } from './worldWebglScaleSpec'
import { getWorldSystemPresetSpec } from './worldWebglSystemPreset'

const WORLD_SCALE_SPEC = getWorldScaleSpec()
const WORLD_SYSTEM_PRESET = getWorldSystemPresetSpec()
const WORLD_VIEW_FILL = WORLD_SYSTEM_PRESET.orbitRadiusScale < 1 ? 0.72 : 0.64

function toWorldPosition(snapshot: WorldMapSnapshot, planet: WorldMapPlanet): THREE.Vector3 {
  const x = (planet.x - snapshot.center.x) * 0.042
  const y = (snapshot.center.y - planet.y) * 0.027
  const z = Math.sin(planet.angle * 1.7) * 0.9
  return new THREE.Vector3(x, y, z)
}

export function computeFitToViewState(snapshot: WorldMapSnapshot, planets: WorldMapPlanet[], aspect: number): { target: THREE.Vector3; position: THREE.Vector3 } {
  const points = planets.map((planet) => toWorldPosition(snapshot, planet))
  const box = new THREE.Box3().setFromPoints(points.length ? points : [new THREE.Vector3()])
  const target = box.getCenter(new THREE.Vector3())
  const sphere = box.getBoundingSphere(new THREE.Sphere())
  const maxRingRadius = snapshot.rings.reduce((acc, ring) => Math.max(acc, Math.min(ring.radius * 0.045 * WORLD_SCALE_SPEC.orbitRadiusScale * WORLD_SYSTEM_PRESET.orbitRadiusScale, WORLD_SYSTEM_PRESET.maxOrbitRadius)), 0)
  const coreRadius = 1.95 * WORLD_SCALE_SPEC.coreRadiusScale
  const maxRadius = Math.max(sphere.radius + WORLD_SCALE_SPEC.planetRadiusScale * 0.25, maxRingRadius, coreRadius)
  const fov = THREE.MathUtils.degToRad(46)
  const fitHeightDistance = maxRadius / Math.tan(fov * 0.5)
  const fitWidthDistance = fitHeightDistance / Math.max(0.75, aspect)
  const distance = Math.max(fitHeightDistance, fitWidthDistance) / WORLD_VIEW_FILL
  const position = target.clone().add(new THREE.Vector3(distance * 0.12, distance * 0.36, distance))
  return { target, position }
}

export function orbitPulseOpacity(baseOpacity: number, reducedMotion: boolean, timeSeconds: number, objectId: number): number {
  if (reducedMotion) return baseOpacity
  return baseOpacity + Math.sin(timeSeconds * 1.5 + objectId) * 0.08
}
