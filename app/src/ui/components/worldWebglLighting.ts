import * as THREE from 'three'

export function applySceneEnvironment(scene: THREE.Scene, texture: THREE.Texture): void {
  scene.environment = texture
}
