import type * as THREE from 'three'
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

interface WorldCameraStateV1 {
  version: 1
  position: [number, number, number]
  quaternion: [number, number, number, number]
  zoom: number
  target: [number, number, number]
}

const WORLD_CAMERA_STATE_KEY = 'worldCameraState'

export function readWorldCameraState(): WorldCameraStateV1 | null {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(WORLD_CAMERA_STATE_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as WorldCameraStateV1
    if (parsed.version !== 1) return null
    if (parsed.position.length !== 3 || parsed.quaternion.length !== 4 || parsed.target.length !== 3) return null
    return parsed
  } catch {
    return null
  }
}

export function writeWorldCameraState(camera: THREE.PerspectiveCamera, controls: OrbitControls): void {
  if (typeof window === 'undefined') return
  const state: WorldCameraStateV1 = {
    version: 1,
    position: [camera.position.x, camera.position.y, camera.position.z],
    quaternion: [camera.quaternion.x, camera.quaternion.y, camera.quaternion.z, camera.quaternion.w],
    zoom: camera.zoom,
    target: [controls.target.x, controls.target.y, controls.target.z],
  }
  window.localStorage.setItem(WORLD_CAMERA_STATE_KEY, JSON.stringify(state))
}
