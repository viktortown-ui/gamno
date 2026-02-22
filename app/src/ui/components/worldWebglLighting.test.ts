import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'

import { applySceneEnvironment, collectLightingDiagnostics, warnIfLightingInvalid } from './worldWebglLighting'

describe('worldWebglLighting', () => {
  it('sets scene.environment in webgl world mode', () => {
    const scene = new THREE.Scene()
    const texture = new THREE.Texture()

    applySceneEnvironment(scene, texture)

    expect(scene.environment).toBe(texture)
  })

  it('reports environment and light counts for mount diagnostics', () => {
    const scene = new THREE.Scene()
    applySceneEnvironment(scene, new THREE.Texture())
    scene.add(new THREE.HemisphereLight(0xffffff, 0x111111, 0.3), new THREE.DirectionalLight(0xffffff, 1))

    const diagnostics = collectLightingDiagnostics(scene)

    expect(diagnostics.environment.exists).toBe(true)
    expect(diagnostics.lightCount).toBeGreaterThan(0)
  })

  it('warns in dev when lighting is invalid', () => {
    const scene = new THREE.Scene()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const diagnostics = warnIfLightingInvalid(scene)

    expect(diagnostics.environment.exists).toBe(false)
    expect(diagnostics.lightCount).toBe(0)
    expect(warn).toHaveBeenCalledWith('[World] Lighting invalid -> planets may render black')
    warn.mockRestore()
  })
})
