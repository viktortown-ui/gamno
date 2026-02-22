import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react'
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import type { WorldMapPlanet, WorldMapSnapshot } from '../../core/worldMap/types'
import { computeFitToViewState, orbitPulseOpacity } from './worldWebglSceneMath'
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

const BLOOM_LAYER = 1
const ORBIT_SEGMENTS = 128
const BLOOM_PARAMS = {
  threshold: 0.62,
  strength: 0.62,
  radius: 0.36,
  exposure: 1.25,
}
const EXPOSURE_RANGE = { min: 1.1, max: 1.4 }

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

function buildGradientEnvironmentMap(renderer: THREE.WebGLRenderer): THREE.Texture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return new THREE.Texture()
  }
  const gradient = ctx.createLinearGradient(0, 0, 0, size)
  gradient.addColorStop(0, '#8ab6ff')
  gradient.addColorStop(0.4, '#1f305c')
  gradient.addColorStop(1, '#040812')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.mapping = THREE.EquirectangularReflectionMapping
  const pmrem = new THREE.PMREMGenerator(renderer)
  pmrem.compileEquirectangularShader()
  const envMap = pmrem.fromEquirectangular(texture).texture
  texture.dispose()
  pmrem.dispose()
  return envMap
}


function computeDebugBoundingRadius(snapshot: WorldMapSnapshot, planets: WorldMapPlanet[]): number {
  const maxPlanetRadius = planets.reduce((acc, planet) => {
    const point = toWorldPosition(snapshot, planet)
    return Math.max(acc, point.length())
  }, 0)
  const maxRingRadius = snapshot.rings.reduce((acc, ring) => Math.max(acc, ring.radius * 0.045), 0)
  return Math.max(maxPlanetRadius, maxRingRadius)
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
  const [debugState, setDebugState] = useState<{ cameraDistance: number; boundingRadius: number; exposure: number; overlayAlpha: number } | null>(null)

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

  const stormAlpha = Math.min(0.45, Math.max(0.08, snapshot.metrics.risk * 0.22 + (snapshot.metrics.sirenLevel === 'red' ? 0.14 : 0.05)))
  const tailAlpha = Math.min(0.32, snapshot.metrics.esCollapse10 * 0.66 + 0.06)
  const overlayStyle = useMemo(() => ({
    '--storm-alpha': String(stormAlpha),
    '--tail-alpha': String(tailAlpha),
  } as CSSProperties), [stormAlpha, tailAlpha])

  useEffect(() => {
    const host = sceneRef.current
    if (!host) return

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setSize(host.clientWidth, host.clientHeight)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = THREE.MathUtils.clamp(BLOOM_PARAMS.exposure, EXPOSURE_RANGE.min, EXPOSURE_RANGE.max)
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(uiVariant === 'cinematic' ? 0x040a18 : 0x071022)

    const camera = new THREE.PerspectiveCamera(46, host.clientWidth / host.clientHeight, 0.1, 200)
    const fit = computeFitToViewState(snapshot, planets, camera.aspect)
    camera.position.copy(fit.position)
    camera.lookAt(fit.target)

    const composer = new EffectComposer(renderer)
    composer.addPass(new RenderPass(scene, camera))
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(host.clientWidth, host.clientHeight), BLOOM_PARAMS.strength, BLOOM_PARAMS.radius, BLOOM_PARAMS.threshold)
    composer.addPass(bloomPass)
    const vignettePass = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        strength: { value: 0.26 },
      },
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform sampler2D tDiffuse; uniform float strength; varying vec2 vUv; void main() { vec4 color = texture2D(tDiffuse, vUv); vec2 centered = vUv - 0.5; float vig = smoothstep(0.82, 0.22, dot(centered, centered)); color.rgb *= mix(1.0 - strength, 1.0, vig); gl_FragColor = color; }`,
    })
    composer.addPass(vignettePass)
    composer.addPass(new OutputPass())

    const bloomLayer = new THREE.Layers()
    bloomLayer.set(BLOOM_LAYER)

    scene.fog = new THREE.FogExp2(uiVariant === 'cinematic' ? 0x060d1d : 0x071022, 0.032)
    const environmentMap = buildGradientEnvironmentMap(renderer)
    scene.environment = environmentMap

    const ambient = new THREE.AmbientLight(0x9cc2ff, 0.65)
    const key = new THREE.PointLight(0xb2d2ff, 1.8, 120)
    key.position.set(18, 12, 14)
    const fill = new THREE.PointLight(0x57ffe0, 0.7, 56)
    fill.position.set(-9, 3, 8)
    const coreLight = new THREE.PointLight(0x66d6ff, 2.2, 40)
    coreLight.position.set(0, 0, 0)
    scene.add(ambient, key, fill, coreLight)

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
    core.layers.enable(BLOOM_LAYER)
    halo.layers.enable(BLOOM_LAYER)
    if (snapshot.metrics.safeMode) {
      const shield = new THREE.Mesh(
        new THREE.SphereGeometry(2.08, 24, 24),
        new THREE.MeshBasicMaterial({ color: 0x6fffd8, transparent: true, opacity: 0.12, wireframe: true }),
      )
      coreGroup.add(shield)
    }
    scene.add(coreGroup)

    snapshot.rings.forEach((ring, index) => {
      const points = ringPoints(ring.radius * 0.045, 0.72 + seedFloat(index + snapshot.seed) * 0.1, (seedFloat(index + 7) - 0.5) * 0.4, ORBIT_SEGMENTS)
      const curve = new THREE.CatmullRomCurve3(points, true, 'catmullrom', 0.1)
      const geometry = new THREE.TubeGeometry(curve, ORBIT_SEGMENTS, 0.022 + ring.stormStrength * 0.008, 12, true)
      const color = new THREE.Color(0x8f6bff).lerp(new THREE.Color(0x43f3d0), ring.stormStrength * 0.45)
      const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35 + ring.stormStrength * 0.24, blending: THREE.AdditiveBlending, depthWrite: false })
      const orbit = new THREE.Mesh(geometry, material)
      orbit.rotation.x = -0.35
      orbit.layers.enable(BLOOM_LAYER)
      orbit.userData.orbitBaseOpacity = material.opacity
      scene.add(orbit)
    })

    const planetMeshes = new Map<string, THREE.Mesh>()
    planets.forEach((planet) => {
      const pColor = colorByPlanet(planet)
      const material = new THREE.MeshPhysicalMaterial({
        color: pColor,
        emissive: pColor.clone().multiplyScalar(0.07 + planet.metrics.risk * 0.08),
        emissiveIntensity: 0.52,
        metalness: 0.42,
        roughness: 0.27,
        clearcoat: 0.4,
        clearcoatRoughness: 0.18,
        ior: 1.4,
        envMapIntensity: 1.15,
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
    const dust = new THREE.Points(stars, new THREE.PointsMaterial({ color: 0xb9daff, size: 0.09, transparent: true, opacity: 0.62, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }))
    dust.layers.enable(BLOOM_LAYER)
    scene.add(dust)

    let raf = 0
    const tick = (time: number) => {
      const t = time * 0.001
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh && bloomLayer.test(object.layers)) {
          const material = object.material
          if (material instanceof THREE.MeshBasicMaterial && typeof object.userData.orbitBaseOpacity === 'number') {
            material.opacity = orbitPulseOpacity(object.userData.orbitBaseOpacity, reducedMotion, t, object.id)
          }
        }
      })
      planetMeshes.forEach((mesh, id) => {
        const pulse = pulseRef.current.get(id) ?? 0
        const scaleBoost = reducedMotion ? 0 : pulse * 0.12 * Math.sin(t * 4.5)
        mesh.scale.setScalar(1 + scaleBoost)
        mesh.rotation.y += reducedMotion ? 0 : 0.0035
      })
      core.rotation.y += reducedMotion ? 0 : 0.004
      halo.scale.setScalar(1 + (reducedMotion ? 0 : Math.sin(t * 1.4) * 0.03))
      if (!reducedMotion) {
        camera.position.x = fit.position.x + Math.sin(t * 0.08) * 0.42
        camera.position.z = fit.position.z + Math.cos(t * 0.07) * 0.34
        dust.rotation.y += 0.00035
      }
      camera.lookAt(fit.target)
      if (import.meta.env.DEV) {
        setDebugState({
          cameraDistance: camera.position.distanceTo(fit.target),
          boundingRadius: computeDebugBoundingRadius(snapshot, planets),
          exposure: renderer.toneMappingExposure,
          overlayAlpha: stormAlpha,
        })
      }
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
      const nextFit = computeFitToViewState(snapshot, planets, camera.aspect)
      camera.position.copy(nextFit.position)
      camera.lookAt(nextFit.target)
      camera.updateProjectionMatrix()
      if (import.meta.env.DEV) {
        setDebugState({
          cameraDistance: camera.position.distanceTo(nextFit.target),
          boundingRadius: computeDebugBoundingRadius(snapshot, planets),
          exposure: renderer.toneMappingExposure,
          overlayAlpha: stormAlpha,
        })
      }
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
      environmentMap.dispose()
    }
  }, [planets, reducedMotion, snapshot, stormAlpha, uiVariant])

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
      {import.meta.env.DEV && debugState ? (
        <output className="world-webgl__debug" data-testid="world-webgl-debug">
          cam {debugState.cameraDistance.toFixed(2)} · r {debugState.boundingRadius.toFixed(2)} · exp {debugState.exposure.toFixed(2)} · α {debugState.overlayAlpha.toFixed(2)}
        </output>
      ) : null}
    </div>
  )
}
