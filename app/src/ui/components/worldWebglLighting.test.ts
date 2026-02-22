import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import { applySceneEnvironment } from './worldWebglLighting'

describe('worldWebglLighting', () => {
  it('sets scene.environment in webgl world mode', () => {
    const scene = new THREE.Scene()
    const texture = new THREE.Texture()

    applySceneEnvironment(scene, texture)

    expect(scene.environment).toBe(texture)
  })
})
