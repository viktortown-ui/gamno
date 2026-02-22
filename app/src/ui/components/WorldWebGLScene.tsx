import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react'
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import type { WorldMapPlanet, WorldMapSnapshot } from '../../core/worldMap/types'
import type { WorldFxEvent } from '../../pages/worldCockpit'

interface WorldWebGLSceneProps {
  snapshot: WorldMapSnapshot
  onPlanetSelect?: (planetId: string | null, origin?: HTMLElement | null) => void
  selectedPlanetId?: string | null
  showNeighborLabels?: boolean
  fxEvents?: WorldFxEvent[]
  uiVariant?: 'instrument' | 'cinematic'
  targetPlanetId?: string | null
}

function toWorldPosition(snapshot: WorldMapSnapshot, planet: WorldMapPlanet): THREE.Vector3 {
  const x = (planet.x - snapshot.center.x) * 0.042
  const y = (snapshot.center.y - planet.y) * 0.027
  const z = Math.sin(planet.angle * 1.7) * 0.9
  return new THREE.Vector3(x, y, z)
}

function colorByPlanet(planet: WorldMapPlanet): THREE.Color {
  const hue = (planet.order * 0.11 + planet.metrics.risk * 0.08) % 1
  const saturation = 0.46 + planet.metrics.budgetPressure * 0.4
  const light = 0.5 + planet.metrics.level * 0.04
  return new THREE.Color().setHSL(hue, Math.min(0.9, saturation), Math.min(0.78, light))
}

function seedFloat(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

function ringPoints(radius: number, flatten: number, tilt: number, segments: number): THREE.Vector3[] {
  const points: THREE.Vector3[] = []
  for (let i = 0; i <= segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2
    const point = new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius * flatten)
    point.applyAxisAngle(new THREE.Vector3(0, 0, 1), tilt)
    points.push(point)
  }
  return points
}

export function WorldWebGLScene({
  snapshot,
  onPlanetSelect,
  selectedPlanetId,
  showNeighborLabels = true,
  fxEvents = [],
  uiVariant = 'instrument',
  targetPlanetId = null,
}: WorldWebGLSceneProps) {
  const sceneRef = useRef<HTMLDivElement | null>(null)
  const buttonRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const pulseRef = useRef<Map<string, number>>(new Map())
  const [focusedId, setFocusedId] = useState<string>(snapshot.planets[0]?.id ?? '')
  const [reducedMotion, setReducedMotion] = useState(false)

  const planets = useMemo(() => [...snapshot.planets].sort((a, b) => (a.order - b.order) || a.id.localeCompare(b.id, 'ru')), [snapshot.planets])

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => setReducedMotion(media.matches)
    apply()
    media.addEventListener?.('change', apply)
    return () => media.removeEventListener?.('change', apply)
  }, [])

  const selectedId = selectedPlanetId ?? null

  const visibleLabelIds = useMemo(() => {
    if (!selectedId) return new Set<string>()
    const selectedIndex = planets.findIndex((planet) => planet.id === selectedId)
    if (selectedIndex < 0) return new Set<string>()
    const ids = new Set<string>([selectedId])
    if (showNeighborLabels) {
      const prev = planets[(selectedIndex - 1 + planets.length) % planets.length]
      const next = planets[(selectedIndex + 1) % planets.length]
      if (prev) ids.add(prev.id)
      if (next) ids.add(next.id)
    }
    return ids
  }, [planets, selectedId, showNeighborLabels])

  const overlayStyle = useMemo(() => ({
    '--storm-alpha': String(Math.min(0.42, snapshot.metrics.risk * 0.28 + (snapshot.metrics.sirenLevel === 'red' ? 0.2 : 0.08))),
    '--tail-alpha': String(Math.min(0.32, snapshot.metrics.esCollapse10 * 0.7 + 0.06)),
  } as CSSProperties), [snapshot.metrics])

  useEffect(() => {
    const host = sceneRef.current
    if (!host) return

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setSize(host.clientWidth, host.clientHeight)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(uiVariant === 'cinematic' ? 0x040a18 : 0x071022)

    const camera = new THREE.PerspectiveCamera(46, host.clientWidth / host.clientHeight, 0.1, 200)
    camera.position.set(0, 10.5, 21)
    camera.lookAt(0, 0, 0)

    const composer = new EffectComposer(renderer)
    composer.addPass(new RenderPass(scene, camera))
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(host.clientWidth, host.clientHeight), 0.68, 0.85, 0.44))

    const ambient = new THREE.AmbientLight(0x9cc2ff, 0.65)
    const key = new THREE.PointLight(0x99c6ff, 1.25, 120)
    key.position.set(18, 12, 14)
    scene.add(ambient, key)

    const coreGroup = new THREE.Group()
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(1.02, 32, 32),
      new THREE.MeshStandardMaterial({ color: 0x77b8ff, emissive: 0x3ea5ff, emissiveIntensity: 1.25, metalness: 0.2, roughness: 0.28 }),
    )
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(1.55, 28, 28),
      new THREE.MeshBasicMaterial({ color: 0x65ffd1, transparent: true, opacity: 0.16, side: THREE.DoubleSide }),
    )
    coreGroup.add(core, halo)
    if (snapshot.metrics.safeMode) {
      const shield = new THREE.Mesh(
        new THREE.SphereGeometry(2.08, 24, 24),
        new THREE.MeshBasicMaterial({ color: 0x6fffd8, transparent: true, opacity: 0.12, wireframe: true }),
      )
      coreGroup.add(shield)
    }
    scene.add(coreGroup)

    snapshot.rings.forEach((ring, index) => {
      const points = ringPoints(ring.radius * 0.045, 0.72 + seedFloat(index + snapshot.seed) * 0.1, (seedFloat(index + 7) - 0.5) * 0.4, 128)
      const geometry = new THREE.BufferGeometry().setFromPoints(points)
      const color = new THREE.Color(0x8f6bff).lerp(new THREE.Color(0x43f3d0), ring.stormStrength * 0.45)
      const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.32 + ring.stormStrength * 0.2 })
      const line = new THREE.LineLoop(geometry, material)
      line.rotation.x = -0.35
      scene.add(line)
    })

    const planetMeshes = new Map<string, THREE.Mesh>()
    planets.forEach((planet) => {
      const pColor = colorByPlanet(planet)
      const material = new THREE.MeshStandardMaterial({
        color: pColor,
        emissive: pColor.clone().multiplyScalar(0.24 + planet.metrics.risk * 0.25),
        emissiveIntensity: 0.92,
        metalness: 0.44,
        roughness: 0.36,
      })
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(planet.radius * 0.042, 28, 28), material)
      mesh.position.copy(toWorldPosition(snapshot, planet))
      mesh.userData.planetId = planet.id
      scene.add(mesh)
      planetMeshes.set(planet.id, mesh)
    })

    const stars = new THREE.BufferGeometry()
    const positions = new Float32Array(360 * 3)
    for (let i = 0; i < 360; i += 1) {
      const spread = 42
      positions[i * 3] = (seedFloat(snapshot.seed + i * 3) - 0.5) * spread
      positions[i * 3 + 1] = (seedFloat(snapshot.seed + i * 5) - 0.5) * spread * 0.5
      positions[i * 3 + 2] = (seedFloat(snapshot.seed + i * 7) - 0.5) * spread
    }
    stars.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const dust = new THREE.Points(stars, new THREE.PointsMaterial({ color: 0xb9daff, size: 0.06, transparent: true, opacity: 0.65 }))
    scene.add(dust)

    let raf = 0
    const tick = (time: number) => {
      const t = time * 0.001
      planetMeshes.forEach((mesh, id) => {
        const pulse = pulseRef.current.get(id) ?? 0
        const scaleBoost = reducedMotion ? 0 : pulse * 0.12 * Math.sin(t * 4.5)
        mesh.scale.setScalar(1 + scaleBoost)
        mesh.rotation.y += reducedMotion ? 0 : 0.0035
      })
      core.rotation.y += reducedMotion ? 0 : 0.004
      halo.scale.setScalar(1 + (reducedMotion ? 0 : Math.sin(t * 1.4) * 0.03))
      if (!reducedMotion) {
        camera.position.x = Math.sin(t * 0.08) * 0.5
        camera.position.z = 21 + Math.cos(t * 0.07) * 0.4
        dust.rotation.y += 0.00035
      }
      camera.lookAt(0, 0, 0)
      composer.render()
      raf = window.requestAnimationFrame(tick)
    }
    raf = window.requestAnimationFrame(tick)

    const onResize = () => {
      if (!host) return
      const { clientWidth, clientHeight } = host
      renderer.setSize(clientWidth, clientHeight)
      composer.setSize(clientWidth, clientHeight)
      camera.aspect = clientWidth / clientHeight
      camera.updateProjectionMatrix()
    }
    window.addEventListener('resize', onResize)

    return () => {
      window.cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      host.removeChild(renderer.domElement)
      renderer.dispose()
      composer.dispose()
      scene.traverse((obj: THREE.Object3D) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose()
          if (Array.isArray(obj.material)) obj.material.forEach((m: THREE.Material) => m.dispose())
          else obj.material.dispose()
        }
      })
      stars.dispose()
    }
  }, [planets, reducedMotion, snapshot, uiVariant])

  useEffect(() => {
    const next = new Map<string, number>()
    fxEvents.filter((item) => item.type === 'pulse' && item.planetId).forEach((item) => {
      next.set(item.planetId!, item.intensity)
    })
    pulseRef.current = next
  }, [fxEvents])

  const moveFocus = (direction: -1 | 1) => {
    const currentIndex = planets.findIndex((planet) => planet.id === focusedId)
    if (currentIndex < 0) return
    const next = planets[(currentIndex + direction + planets.length) % planets.length]
    if (next) setFocusedId(next.id)
  }

  const handlePlanetKey = (event: ReactKeyboardEvent<HTMLButtonElement>, planet: WorldMapPlanet) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault()
      moveFocus(1)
      return
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault()
      moveFocus(-1)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      onPlanetSelect?.(planet.id, event.currentTarget)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      onPlanetSelect?.(null)
    }
  }

  return (
    <div
      className={`world-webgl ${reducedMotion ? 'world-webgl--reduced-motion' : ''}`.trim()}
      style={overlayStyle}
      data-motion={reducedMotion ? 'reduced' : 'normal'}
      role="region"
      aria-label="WebGL карта мира"
    >
      <div ref={sceneRef} className="world-webgl__canvas" data-testid="world-webgl-canvas" />
      <div className="world-map__focus-layer" role="listbox" aria-label="Планеты мира" aria-activedescendant={focusedId ? `webgl-option-${focusedId}` : undefined}>
        {planets.map((planet) => (
          <button
            key={`focus:${planet.id}`}
            id={`webgl-option-${planet.id}`}
            type="button"
            role="option"
            aria-selected={selectedId === planet.id}
            className="world-map__focus-point"
            data-planet-id={planet.id}
            style={{ left: `${planet.x}px`, top: `${planet.y}px`, width: `${planet.radius * 2}px`, height: `${planet.radius * 2}px` }}
            tabIndex={focusedId === planet.id ? 0 : -1}
            ref={(element) => {
              if (element) buttonRefs.current.set(planet.id, element)
              else buttonRefs.current.delete(planet.id)
            }}
            onFocus={() => setFocusedId(planet.id)}
            onKeyDown={(event) => handlePlanetKey(event, planet)}
            onClick={(event) => onPlanetSelect?.(planet.id, event.currentTarget)}
          >
            <span className="world-map__sr">{planet.labelRu}</span>
          </button>
        ))}
      </div>
      <div className="world-webgl__labels" aria-hidden="true">
        {planets.filter((planet) => visibleLabelIds.has(planet.id) || targetPlanetId === planet.id).map((planet) => (
          <span key={`label:${planet.id}`} style={{ left: `${planet.x}px`, top: `${planet.y - planet.radius - 8}px` }}>{planet.labelRu}</span>
        ))}
      </div>
    </div>
  )
}
