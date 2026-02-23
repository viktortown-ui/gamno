import * as THREE from 'three'

export const PICK_PROXY_SCALE = 2.2
export const PICK_LAYER = 2

export function createPlanetPickProxy(planetId: string, visibleRadius: number): THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> {
  const proxy = new THREE.Mesh(
    new THREE.SphereGeometry(visibleRadius * PICK_PROXY_SCALE, 18, 18),
    new THREE.MeshBasicMaterial({ color: 0xffffff, visible: false }),
  )
  proxy.layers.set(PICK_LAYER)
  proxy.userData.planetId = planetId
  return proxy
}


export function readWorldMinPlanetPixelRadius(): number {
  const value = globalThis.localStorage?.getItem('worldMinPlanetPx')
  if (value === '12') return 12
  if (value === '16') return 16
  return 0
}

interface FindMagnetPlanetInput {
  camera: THREE.PerspectiveCamera
  planetMeshes: Map<string, THREE.Mesh>
  clickX: number
  clickY: number
  bounds: DOMRect
  thresholdPx: number
}

export function findMagnetPlanet(input: FindMagnetPlanetInput): string | null {
  const { camera, planetMeshes, clickX, clickY, bounds, thresholdPx } = input
  let nearestId: string | null = null
  let nearestDistance = Number.POSITIVE_INFINITY
  const projected = new THREE.Vector3()
  const world = new THREE.Vector3()
  planetMeshes.forEach((mesh, id) => {
    mesh.getWorldPosition(world)
    projected.copy(world).project(camera)
    if (projected.z < -1 || projected.z > 1) return
    const x = bounds.left + (projected.x + 1) * 0.5 * bounds.width
    const y = bounds.top + (1 - (projected.y + 1) * 0.5) * bounds.height
    const dist = Math.hypot(clickX - x, clickY - y)
    if (dist < nearestDistance) {
      nearestDistance = dist
      nearestId = id
    }
  })
  return nearestDistance <= thresholdPx ? nearestId : null
}

export function getPlanetVisualScaleForMinPixelRadius(
  camera: THREE.PerspectiveCamera,
  distanceToCamera: number,
  radiusWorld: number,
  minRadiusPx: number,
): number {
  if (minRadiusPx <= 0 || distanceToCamera <= 0 || radiusWorld <= 0) return 1
  const fovRad = THREE.MathUtils.degToRad(camera.fov)
  const worldHeightAtDistance = 2 * Math.tan(fovRad * 0.5) * distanceToCamera
  const pxPerWorld = (globalThis.innerHeight || 0) / Math.max(1e-6, worldHeightAtDistance)
  const currentRadiusPx = radiusWorld * pxPerWorld
  if (currentRadiusPx >= minRadiusPx) return 1
  return THREE.MathUtils.clamp(minRadiusPx / Math.max(1e-6, currentRadiusPx), 1, 1.6)
}
