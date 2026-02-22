import * as THREE from 'three'
import { collectLightingDiagnostics } from './worldWebglLighting'

export interface WorldDebugHUDState {
  toneMapping: string
  exposure: number
  outputColorSpace: string
  environmentUuid: string | null
  lightCount: number
  selectedMaterial: string
}

export function collectWorldDebugHUDState(
  renderer: Pick<THREE.WebGLRenderer, 'toneMapping' | 'toneMappingExposure' | 'outputColorSpace'>,
  scene: THREE.Scene,
  selectedMaterial: THREE.Material | null,
): WorldDebugHUDState {
  const diagnostics = collectLightingDiagnostics(scene)
  return {
    toneMapping: String(renderer.toneMapping),
    exposure: renderer.toneMappingExposure,
    outputColorSpace: String(renderer.outputColorSpace),
    environmentUuid: diagnostics.environment.uuid,
    lightCount: diagnostics.lightCount,
    selectedMaterial: selectedMaterial?.type ?? 'n/a',
  }
}
