/* @vitest-environment jsdom */
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createPlanetPickProxy, findMagnetPlanet, getPlanetVisualScaleForMinPixelRadius, PICK_LAYER, PICK_PROXY_SCALE, readWorldMinPlanetPixelRadius } from './worldWebglPicking'

describe('worldWebglPicking', () => {
  it('reads minimum planet pixel radius from localStorage values', () => {
    window.localStorage.setItem('worldMinPlanetPx', '12')
    expect(readWorldMinPlanetPixelRadius()).toBe(12)
    window.localStorage.setItem('worldMinPlanetPx', '16')
    expect(readWorldMinPlanetPixelRadius()).toBe(16)
    window.localStorage.setItem('worldMinPlanetPx', '0')
    expect(readWorldMinPlanetPixelRadius()).toBe(0)
  })

  it('supports pick proxy raycast with invisible material', () => {
    const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 100)
    camera.position.set(0, 0, 8)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld()

    const proxy = createPlanetPickProxy('planet:pick', 0.5)

    const raycaster = new THREE.Raycaster()
    raycaster.layers.set(PICK_LAYER)
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera)
    const hit = raycaster.intersectObjects([proxy], true)[0]

    expect(proxy.geometry.parameters.radius).toBeCloseTo(0.5 * PICK_PROXY_SCALE)
    expect(hit?.object.userData.planetId).toBe('planet:pick')
  })

  it('selects nearest planet with magnet fallback when inside threshold', () => {
    Object.defineProperty(window, 'innerHeight', { value: 600, configurable: true })
    const camera = new THREE.PerspectiveCamera(46, 800 / 600, 0.1, 100)
    camera.position.set(0, 0, 8)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld(true)

    const a = new THREE.Mesh(new THREE.SphereGeometry(0.2), new THREE.MeshBasicMaterial())
    a.position.set(-0.2, 0, 0)
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.2), new THREE.MeshBasicMaterial())
    b.position.set(0.6, 0, 0)
    const meshes = new Map<string, THREE.Mesh>([
      ['planet:a', a],
      ['planet:b', b],
    ])

    const picked = findMagnetPlanet({
      camera,
      planetMeshes: meshes,
      clickX: 390,
      clickY: 300,
      bounds: new DOMRect(0, 0, 800, 600),
      thresholdPx: 24,
    })

    expect(picked).toBe('planet:a')
  })

  it('clamps visual scale boost to preserve composition', () => {
    Object.defineProperty(window, 'innerHeight', { value: 600, configurable: true })
    const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 100)
    const scale = getPlanetVisualScaleForMinPixelRadius(camera, 25, 0.1, 16)
    expect(scale).toBeLessThanOrEqual(1.6)
    expect(scale).toBeGreaterThanOrEqual(1)
  })
})
