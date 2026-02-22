import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

const iblCache = new WeakMap<THREE.WebGLRenderer, { renderTarget: THREE.WebGLRenderTarget; refCount: number }>()

export interface IBLHandle {
  texture: THREE.Texture
  dispose: () => void
}

export function createIBL(renderer: THREE.WebGLRenderer): IBLHandle {
  const cached = iblCache.get(renderer)
  if (cached) {
    cached.refCount += 1
    return {
      texture: cached.renderTarget.texture,
      dispose: () => {
        cached.refCount -= 1
        if (cached.refCount <= 0) {
          cached.renderTarget.dispose()
          iblCache.delete(renderer)
        }
      },
    }
  }

  const envScene = new RoomEnvironment()
  const pmrem = new THREE.PMREMGenerator(renderer)
  const renderTarget = pmrem.fromScene(envScene)
  envScene.dispose()
  pmrem.dispose()

  const nextEntry = { renderTarget, refCount: 1 }
  iblCache.set(renderer, nextEntry)

  return {
    texture: renderTarget.texture,
    dispose: () => {
      nextEntry.refCount -= 1
      if (nextEntry.refCount <= 0) {
        nextEntry.renderTarget.dispose()
        iblCache.delete(renderer)
      }
    },
  }
}

export function applySceneEnvironment(scene: THREE.Scene, texture: THREE.Texture): void {
  scene.environment = texture
}
