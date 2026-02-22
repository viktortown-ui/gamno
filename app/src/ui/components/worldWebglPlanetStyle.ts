import * as THREE from 'three'
import type { WorldMapPlanet } from '../../core/worldMap/types'

export type PlanetSurfaceType = 'stone' | 'ice' | 'gas'

export interface PlanetPalette {
  baseColor: THREE.Color
  emissiveColor: THREE.Color
  type: PlanetSurfaceType
}

export interface PlanetMaterialTuning {
  metalness: number
  roughness: number
  envMapIntensity: number
  emissiveIntensity: number
  clearcoat: number
  clearcoatRoughness: number
}

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

export function planetPaletteFromId(id: string, seed: number): PlanetPalette {
  const baseSeed = hashString(`${id}:${seed}`)
  const roll = hashToUnit(baseSeed)
  const type: PlanetSurfaceType = roll < 0.46 ? 'stone' : roll < 0.74 ? 'ice' : 'gas'

  const hue = hashToUnit(baseSeed ^ 0x9e3779b9)
  const saturation = 0.45 + hashToUnit(baseSeed ^ 0x85ebca6b) * 0.3
  const lightness = 0.42 + hashToUnit(baseSeed ^ 0xc2b2ae35) * 0.24

  const baseColor = new THREE.Color().setHSL(hue, saturation, lightness)
  const emissiveColor = baseColor.clone().multiplyScalar(0.55)

  return { baseColor, emissiveColor, type }
}

export function planetMaterialTuningFromPalette(type: PlanetSurfaceType, planet: WorldMapPlanet): PlanetMaterialTuning {
  const riskTilt = Math.min(0.2, Math.max(0, planet.metrics.risk * 0.12))
  if (type === 'stone') {
    return {
      metalness: 0.04,
      roughness: 0.88 - riskTilt,
      envMapIntensity: 1.3,
      emissiveIntensity: 0.09,
      clearcoat: 0,
      clearcoatRoughness: 1,
    }
  }
  if (type === 'ice') {
    return {
      metalness: 0.08,
      roughness: 0.66 - riskTilt * 0.4,
      envMapIntensity: 1.4,
      emissiveIntensity: 0.11,
      clearcoat: 0.22,
      clearcoatRoughness: 0.2,
    }
  }
  return {
    metalness: 0.06,
    roughness: 0.62,
    envMapIntensity: 1.25,
    emissiveIntensity: 0.1,
    clearcoat: 0,
    clearcoatRoughness: 1,
  }
}

export function applyPlanetMaterialTuning(material: THREE.MeshPhysicalMaterial, tuning: PlanetMaterialTuning): void {
  material.metalness = tuning.metalness
  material.roughness = tuning.roughness
  material.envMapIntensity = tuning.envMapIntensity
  material.emissiveIntensity = tuning.emissiveIntensity
  material.clearcoat = tuning.clearcoat
  material.clearcoatRoughness = tuning.clearcoatRoughness
}

export function createPlanetMaterial(
  palette: PlanetPalette,
  tuning: PlanetMaterialTuning,
  envMap: THREE.Texture,
  forceUnlit: boolean,
): THREE.MeshBasicMaterial | THREE.MeshPhysicalMaterial {
  if (forceUnlit) {
    return new THREE.MeshBasicMaterial({ color: palette.baseColor.clone() })
  }

  const material = new THREE.MeshPhysicalMaterial({
    color: palette.baseColor.clone(),
    emissive: palette.baseColor.clone().multiplyScalar(0.2),
    ior: 1.38,
    envMapIntensity: Math.max(1.2, tuning.envMapIntensity),
    envMap,
  })
  applyPlanetMaterialTuning(material, tuning)
  material.metalness = Math.min(material.metalness, 0.15)
  material.color.copy(palette.baseColor)
  material.emissiveIntensity = THREE.MathUtils.clamp(tuning.emissiveIntensity, 0.08, 0.15)
  material.userData.baseEmissiveIntensity = material.emissiveIntensity
  return material
}
