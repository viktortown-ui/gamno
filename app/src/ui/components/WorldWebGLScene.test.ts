/* @vitest-environment jsdom */
import { describe, expect, it } from 'vitest'
import type { WorldMapSnapshot } from '../../core/worldMap/types'
import * as THREE from 'three'
import { computeFitToViewState, orbitPulseOpacity } from './worldWebglSceneMath'
import { resolveAAMode } from './worldWebglAAMode'
import { readWorldCameraState, writeWorldCameraState } from './worldWebglCameraState'

const snapshot: WorldMapSnapshot = {
  id: 'snapshot:test',
  ts: 1,
  seed: 42,
  viewport: { width: 1200, height: 800, padding: 48 },
  center: { x: 600, y: 400 },
  metrics: { level: 3, risk: 0.2, esCollapse10: 0.1, failProbability: 0.2, budgetPressure: 0.3, safeMode: false, sirenLevel: 'green' },
  rings: [{ id: 'ring:0', domainId: 'core', radius: 260, width: 14, stormStrength: 0.3 }],
  storms: [],
  domains: [],
  planets: [
    { id: 'planet:1', domainId: 'core', order: 1, labelRu: 'Альфа', weight: 1, importance: 1, radius: 14, x: 350, y: 310, angle: 0.2, metrics: { level: 3, risk: 0.2, esCollapse10: 0.2, failProbability: 0.2, budgetPressure: 0.3, safeMode: false, sirenLevel: 'green' }, renderHints: { hasStorm: false, stormStrength: 0.1, tailRisk: 0.2, drawTailGlow: false } },
    { id: 'planet:2', domainId: 'risk', order: 2, labelRu: 'Бета', weight: 1, importance: 1, radius: 16, x: 880, y: 520, angle: 1.2, metrics: { level: 4, risk: 0.4, esCollapse10: 0.2, failProbability: 0.2, budgetPressure: 0.3, safeMode: false, sirenLevel: 'green' }, renderHints: { hasStorm: true, stormStrength: 0.2, tailRisk: 0.2, drawTailGlow: true } },
  ],
}

describe('WorldWebGLScene helpers', () => {
  it('returns deterministic fit-to-view camera state for equal inputs', () => {
    const first = computeFitToViewState(snapshot, snapshot.planets, 16 / 9)
    const second = computeFitToViewState(snapshot, snapshot.planets, 16 / 9)

    expect(first.target.toArray()).toEqual(second.target.toArray())
    expect(first.position.toArray()).toEqual(second.position.toArray())
  })

  it('respects reduced-motion by disabling orbit pulse opacity animation', () => {
    expect(orbitPulseOpacity(0.5, true, 4, 12)).toBe(0.5)
    expect(orbitPulseOpacity(0.5, false, 4, 12)).not.toBe(0.5)
  })



  it('roundtrips worldCameraState with camera position and controls target', () => {
    window.localStorage.clear()
    const camera = new THREE.PerspectiveCamera(46, 16 / 9, 0.1, 200)
    camera.position.set(5, 6, 7)
    camera.quaternion.set(0.1, 0.2, 0.3, 0.9).normalize()
    camera.zoom = 1.25

    const controls = { target: new THREE.Vector3(1, 2, 3) } as unknown as import('three/examples/jsm/controls/OrbitControls.js').OrbitControls
    writeWorldCameraState(camera, controls)

    expect(readWorldCameraState()).toEqual({
      version: 1,
      position: [5, 6, 7],
      quaternion: [camera.quaternion.x, camera.quaternion.y, camera.quaternion.z, camera.quaternion.w],
      zoom: 1.25,
      target: [1, 2, 3],
    })
  })

  it('ignores malformed worldCameraState payloads', () => {
    window.localStorage.setItem('worldCameraState', JSON.stringify({ version: 1, position: [1, 2], quaternion: [1, 2, 3, 4], zoom: 1, target: [1, 2, 3] }))
    expect(readWorldCameraState()).toBeNull()
  })
  it('falls back to FXAA when MSAA is not available', () => {
    expect(resolveAAMode(null, false)).toBe('fxaa')
    expect(resolveAAMode('msaa', false)).toBe('fxaa')
    expect(resolveAAMode('fxaa', true)).toBe('fxaa')
    expect(resolveAAMode(null, true)).toBe('msaa')
  })
})
