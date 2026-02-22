import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react'
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { WebGLRenderTarget } from 'three'
import { resolveAAMode, type AAMode } from './worldWebglAAMode'
import type { WorldMapPlanet, WorldMapSnapshot } from '../../core/worldMap/types'
import { computeFitToViewState, orbitPulseOpacity } from './worldWebglSceneMath'
import type { WorldFxEvent } from '../../pages/worldCockpit'
import { readWorldCameraState, writeWorldCameraState } from './worldWebglCameraState'
import { IdleDriftController } from './worldWebglIdleDrift'
import { applyPlanetMaterialTuning, planetMaterialTuningFromPalette, planetPaletteFromId } from './worldWebglPlanetStyle'
import { applySceneEnvironment } from './worldWebglLighting'

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
const ORBIT_SEGMENTS = 192
const ORBIT_RADIAL_SEGMENTS = 20
const BLOOM_PARAMS = {
  threshold: 0.62,
  strength: 0.62,
  radius: 0.36,
  exposure: 1.25,
}
const EXPOSURE_RANGE = { min: 1.1, max: 1.4 }

interface PlanetOrbitState {
  mesh: THREE.Mesh
  baseY: number
  orbitRadius: number
  driftSpeed: number
  phase: number
}

function toWorldPosition(snapshot: WorldMapSnapshot, planet: WorldMapPlanet): THREE.Vector3 {
  const x = (planet.x - snapshot.center.x) * 0.042
  const y = (snapshot.center.y - planet.y) * 0.027
  const z = Math.sin(planet.angle * 1.7) * 0.9
  return new THREE.Vector3(x, y, z)
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

function createIBL(renderer: THREE.WebGLRenderer): { texture: THREE.Texture; dispose: () => void } {
  const pmrem = new THREE.PMREMGenerator(renderer)
  const room = new RoomEnvironment()
  const texture = pmrem.fromScene(room).texture
  room.dispose()
  return {
    texture,
    dispose: () => {
      texture.dispose()
      pmrem.dispose()
    },
  }
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
  fxEvents = [],
  uiVariant = 'instrument',
}: WorldWebGLSceneProps) {
  const sceneRef = useRef<HTMLDivElement | null>(null)
  const buttonRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const pulseRef = useRef<Map<string, number>>(new Map())
  const [focusedId, setFocusedId] = useState<string>(snapshot.planets[0]?.id ?? '')
  const [reducedMotion, setReducedMotion] = useState(false)
  const [debugState, setDebugState] = useState<{ cameraDistance: number; boundingRadius: number; exposure: number; overlayAlpha: number } | null>(null)
  const [devExposure, setDevExposure] = useState(BLOOM_PARAMS.exposure)
  const [devBloomStrength, setDevBloomStrength] = useState(BLOOM_PARAMS.strength)
  const [devAAMode, setDevAAMode] = useState<AAMode>('msaa')
  const resetViewRef = useRef<() => void>(() => {})
  const selectedIdRef = useRef<string | null>(selectedPlanetId ?? null)
  const onPlanetSelectRef = useRef(onPlanetSelect)
  const [hoveredPlanetLabel, setHoveredPlanetLabel] = useState<{ id: string; labelRu: string; x: number; y: number; radius: number } | null>(null)

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

  useEffect(() => {
    selectedIdRef.current = selectedPlanetId ?? null
  }, [selectedPlanetId])

  useEffect(() => {
    onPlanetSelectRef.current = onPlanetSelect
  }, [onPlanetSelect])

  const visibleLabelIds = useMemo(() => (selectedId ? new Set<string>([selectedId]) : new Set<string>()), [selectedId])

  const stormAlpha = Math.min(0.45, Math.max(0.08, snapshot.metrics.risk * 0.22 + (snapshot.metrics.sirenLevel === 'red' ? 0.14 : 0.05)))
  const tailAlpha = Math.min(0.32, snapshot.metrics.esCollapse10 * 0.66 + 0.06)
  const overlayStyle = useMemo(() => ({
    '--storm-alpha': String(stormAlpha),
    '--tail-alpha': String(tailAlpha),
  } as CSSProperties), [stormAlpha, tailAlpha])

  useEffect(() => {
    const host = sceneRef.current
    if (!host) return

    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true })
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
    renderer.setPixelRatio(pixelRatio)
    renderer.setSize(host.clientWidth, host.clientHeight)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = THREE.MathUtils.clamp(devExposure, EXPOSURE_RANGE.min, EXPOSURE_RANGE.max)
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(uiVariant === 'cinematic' ? 0x040a18 : 0x071022)

    const camera = new THREE.PerspectiveCamera(46, host.clientWidth / host.clientHeight, 0.1, 200)
    const fit = computeFitToViewState(snapshot, planets, camera.aspect)
    const persistedCamera = readWorldCameraState()
    if (persistedCamera) {
      camera.position.set(...persistedCamera.position)
      camera.quaternion.set(...persistedCamera.quaternion)
      camera.zoom = persistedCamera.zoom
      camera.updateProjectionMatrix()
    } else {
      camera.position.copy(fit.position)
      camera.lookAt(fit.target)
    }

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.rotateSpeed = 0.75
    controls.zoomSpeed = 0.9
    controls.panSpeed = 0.75
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    }
    controls.listenToKeyEvents(window)
    controls.keys = {
      LEFT: 'ArrowLeft',
      UP: 'ArrowUp',
      RIGHT: 'ArrowRight',
      BOTTOM: 'ArrowDown',
    }
    const updateControlBounds = (fitState: { position: THREE.Vector3; target: THREE.Vector3 }, nextTarget?: THREE.Vector3) => {
      const distance = fitState.position.distanceTo(fitState.target)
      controls.minDistance = Math.max(2.4, distance * 0.45)
      controls.maxDistance = Math.max(5.5, distance * 1.9)
      if (nextTarget) controls.target.copy(nextTarget)
      controls.update()
    }
    if (persistedCamera) {
      updateControlBounds(fit, new THREE.Vector3(...persistedCamera.target))
    } else {
      updateControlBounds(fit, fit.target)
      writeWorldCameraState(camera, controls)
    }
    controls.saveState()

    const isWebGL2 = renderer.capabilities.isWebGL2
    const activeAAMode = resolveAAMode(import.meta.env.DEV ? devAAMode : null, isWebGL2)
    const renderTarget = new WebGLRenderTarget(host.clientWidth * pixelRatio, host.clientHeight * pixelRatio, {
      format: THREE.RGBAFormat,
      colorSpace: THREE.SRGBColorSpace,
      samples: activeAAMode === 'msaa' && isWebGL2 ? 4 : 0,
    })
    const composer = new EffectComposer(renderer, renderTarget)
    composer.setPixelRatio(pixelRatio)
    composer.addPass(new RenderPass(scene, camera))
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(host.clientWidth, host.clientHeight), devBloomStrength, BLOOM_PARAMS.radius, BLOOM_PARAMS.threshold)
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
    const fxaaPass = new ShaderPass(FXAAShader)
    fxaaPass.enabled = activeAAMode === 'fxaa'
    fxaaPass.material.uniforms.resolution.value.set(1 / (host.clientWidth * pixelRatio), 1 / (host.clientHeight * pixelRatio))
    composer.addPass(fxaaPass)
    composer.addPass(new OutputPass())

    const bloomLayer = new THREE.Layers()
    bloomLayer.set(BLOOM_LAYER)

    scene.fog = new THREE.FogExp2(uiVariant === 'cinematic' ? 0x060d1d : 0x071022, 0.032)
    const ibl = createIBL(renderer)
    applySceneEnvironment(scene, ibl.texture)

    const ambient = new THREE.AmbientLight(0xaad0ff, 0.74)
    const key = new THREE.DirectionalLight(0xd8e8ff, 1.05)
    key.position.set(16, 14, 10)
    const fill = new THREE.DirectionalLight(0x6effdf, 0.34)
    fill.position.set(-14, 3, 11)
    const hemi = new THREE.HemisphereLight(0x8cb9ff, 0x081225, 0.42)
    const coreLight = new THREE.PointLight(0x66d6ff, 2.2, 40)
    coreLight.position.set(0, 0, 0)
    scene.add(ambient, key, fill, hemi, coreLight)

    const coreGroup = new THREE.Group()
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(1.0, 64, 64),
      new THREE.MeshStandardMaterial({ color: 0x6baeff, emissive: 0x4bd5ff, emissiveIntensity: 0.72, metalness: 0.06, roughness: 0.58 }),
    )
    const fresnelShell = new THREE.Mesh(
      new THREE.SphereGeometry(1.18, 64, 64),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          glowColor: { value: new THREE.Color(0x7ce3ff) },
          opacity: { value: 0.34 },
          fresnelPower: { value: 3.6 },
        },
        vertexShader: `varying vec3 vNormal; varying vec3 vViewDir; void main() { vec4 worldPos = modelMatrix * vec4(position, 1.0); vNormal = normalize(mat3(modelMatrix) * normal); vViewDir = normalize(cameraPosition - worldPos.xyz); gl_Position = projectionMatrix * viewMatrix * worldPos; }`,
        fragmentShader: `uniform vec3 glowColor; uniform float opacity; uniform float fresnelPower; varying vec3 vNormal; varying vec3 vViewDir; void main() { float fresnel = pow(1.0 - max(dot(normalize(vNormal), normalize(vViewDir)), 0.0), fresnelPower); gl_FragColor = vec4(glowColor, fresnel * opacity); }`,
      }),
    )
    const halo = new THREE.Mesh(
      new THREE.RingGeometry(1.35, 1.95, 96),
      new THREE.MeshBasicMaterial({ color: 0x67ffdb, transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    )
    halo.rotation.x = Math.PI / 2
    coreGroup.add(core, fresnelShell, halo)
    core.layers.enable(BLOOM_LAYER)
    halo.layers.enable(BLOOM_LAYER)
    if (snapshot.metrics.safeMode) {
      const shield = new THREE.Mesh(
        new THREE.SphereGeometry(2.08, 48, 48),
        new THREE.MeshBasicMaterial({ color: 0x6fffd8, transparent: true, opacity: 0.12, wireframe: true }),
      )
      coreGroup.add(shield)
    }
    scene.add(coreGroup)

    snapshot.rings.forEach((ring, index) => {
      const points = ringPoints(ring.radius * 0.045, 0.72 + seedFloat(index + snapshot.seed) * 0.1, (seedFloat(index + 7) - 0.5) * 0.4, ORBIT_SEGMENTS)
      const curve = new THREE.CatmullRomCurve3(points, true, 'catmullrom', 0.1)
      const geometry = new THREE.TubeGeometry(curve, ORBIT_SEGMENTS, 0.022 + ring.stormStrength * 0.008, ORBIT_RADIAL_SEGMENTS, true)
      const color = new THREE.Color(0x8f6bff).lerp(new THREE.Color(0x43f3d0), ring.stormStrength * 0.45)
      const indexFalloff = 1 - (index / Math.max(1, snapshot.rings.length - 1)) * 0.2
      const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: (0.35 + ring.stormStrength * 0.24) * indexFalloff, blending: THREE.AdditiveBlending, depthWrite: false })
      const orbit = new THREE.Mesh(geometry, material)
      orbit.rotation.x = -0.35
      orbit.layers.enable(BLOOM_LAYER)
      orbit.userData.orbitBaseOpacity = material.opacity
      scene.add(orbit)
    })

    const planetMeshes = new Map<string, THREE.Mesh>()
    const planetOrbitStates: PlanetOrbitState[] = []
    planets.forEach((planet) => {
      const palette = planetPaletteFromId(planet.id, snapshot.seed)
      const tuning = planetMaterialTuningFromPalette(palette.type, planet)
      const material = new THREE.MeshPhysicalMaterial({
        color: palette.baseColor,
        emissive: palette.emissiveColor,
        ior: 1.38,
        envMapIntensity: tuning.envMapIntensity,
        envMap: ibl.texture,
      })
      applyPlanetMaterialTuning(material, tuning)
      material.userData.baseEmissiveIntensity = tuning.emissiveIntensity
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(planet.radius * 0.042, 36, 36), material)
      const basePosition = toWorldPosition(snapshot, planet)
      const orbitRadius = Math.max(0.45, Math.hypot(basePosition.x, basePosition.z))
      const speedSeed = seedFloat(snapshot.seed + planet.order * 17 + planet.id.length * 13)
      const driftSpeed = 0.032 + speedSeed * 0.028
      const phase = Math.atan2(basePosition.z, basePosition.x)
      mesh.position.copy(basePosition)
      mesh.userData.planetId = planet.id
      scene.add(mesh)
      planetOrbitStates.push({ mesh, baseY: basePosition.y, orbitRadius, driftSpeed, phase })
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
    scene.add(dust)

    const hoverRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.72, 0.04, 10, 42),
      new THREE.MeshBasicMaterial({ color: 0x8df9ff, transparent: true, opacity: 0.82, blending: THREE.AdditiveBlending, depthWrite: false }),
    )
    hoverRing.visible = false
    hoverRing.layers.enable(BLOOM_LAYER)
    scene.add(hoverRing)

    const selectionRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.92, 0.05, 12, 48),
      new THREE.MeshBasicMaterial({ color: 0xffd06a, transparent: true, opacity: 0.84, blending: THREE.AdditiveBlending, depthWrite: false }),
    )
    selectionRing.visible = false
    selectionRing.layers.enable(BLOOM_LAYER)
    scene.add(selectionRing)

    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    const intersectTargets = [...planetMeshes.values()]
    let hoveredPlanetId: string | null = null
    const darkMaterial = new THREE.MeshBasicMaterial({ color: 'black' })
    const restoredMaterials = new Map<string, THREE.Material | THREE.Material[]>()

    const darkenNonBloomed = (obj: THREE.Object3D) => {
      if (!(obj instanceof THREE.Mesh)) return
      if (bloomLayer.test(obj.layers)) return
      restoredMaterials.set(obj.uuid, obj.material)
      obj.material = darkMaterial
    }

    const restoreMaterial = (obj: THREE.Object3D) => {
      if (!(obj instanceof THREE.Mesh)) return
      const material = restoredMaterials.get(obj.uuid)
      if (!material) return
      obj.material = material
      restoredMaterials.delete(obj.uuid)
    }

    const applyHighlight = () => {
      planetMeshes.forEach((mesh, id) => {
        const material = mesh.material
        if (!(material instanceof THREE.MeshPhysicalMaterial)) return
        const selectedBoost = selectedIdRef.current === id ? 0.24 : 0
        const hoverBoost = hoveredPlanetId === id ? 0.16 : 0
        material.emissiveIntensity = (material.userData.baseEmissiveIntensity as number ?? 0.22) + selectedBoost + hoverBoost
      })

      const hoveredMesh = hoveredPlanetId ? planetMeshes.get(hoveredPlanetId) : null
      if (hoveredMesh) {
        hoverRing.visible = true
        hoverRing.position.copy(hoveredMesh.position)
        hoverRing.rotation.x = Math.PI / 2
        hoverRing.scale.setScalar(Math.max(1.1, hoveredMesh.scale.x * 1.1 + 0.1))
      } else {
        hoverRing.visible = false
      }

      const selectedMesh = selectedIdRef.current ? planetMeshes.get(selectedIdRef.current) : null
      if (selectedMesh) {
        selectionRing.visible = true
        selectionRing.position.copy(selectedMesh.position)
        selectionRing.rotation.x = Math.PI / 2
        selectionRing.scale.setScalar(Math.max(1.15, selectedMesh.scale.x * 1.15 + 0.12))
      } else {
        selectionRing.visible = false
      }
    }
    applyHighlight()

    const pickPlanet = (event: PointerEvent | MouseEvent): string | null => {
      const bounds = renderer.domElement.getBoundingClientRect()
      pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1
      pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)
      const hit = raycaster.intersectObjects(intersectTargets, false)[0]
      return (hit?.object.userData.planetId as string | undefined) ?? null
    }

    const resetView = () => {
      const resetFit = computeFitToViewState(snapshot, planets, camera.aspect)
      camera.position.copy(resetFit.position)
      controls.target.copy(resetFit.target)
      updateControlBounds(resetFit, resetFit.target)
      controls.saveState()
      writeWorldCameraState(camera, controls)
    }
    resetViewRef.current = resetView

    const onPointerMove = (event: PointerEvent) => {
      driftController.notifyUserAction(performance.now())
      const nextHoveredId = pickPlanet(event)
      if (hoveredPlanetId === nextHoveredId) return
      hoveredPlanetId = nextHoveredId
      if (!nextHoveredId) {
        setHoveredPlanetLabel(null)
      } else {
        const hoveredPlanet = planets.find((planet) => planet.id === nextHoveredId)
        if (hoveredPlanet) {
          setHoveredPlanetLabel({ id: hoveredPlanet.id, labelRu: hoveredPlanet.labelRu, x: hoveredPlanet.x, y: hoveredPlanet.y, radius: hoveredPlanet.radius })
        }
      }
      applyHighlight()
    }
    const onPointerLeave = () => {
      driftController.notifyUserAction(performance.now())
      hoveredPlanetId = null
      setHoveredPlanetLabel(null)
      applyHighlight()
    }
    const onClick = (event: MouseEvent) => {
      driftController.notifyUserAction(performance.now())
      const picked = pickPlanet(event)
      if (picked) {
        onPlanetSelectRef.current?.(picked)
      } else {
        onPlanetSelectRef.current?.(null)
      }
    }
    renderer.domElement.addEventListener('pointermove', onPointerMove)
    renderer.domElement.addEventListener('pointerleave', onPointerLeave)
    const onWheel = () => driftController.notifyUserAction(performance.now())
    const onPointerDown = () => driftController.notifyUserAction(performance.now())
    renderer.domElement.addEventListener('click', onClick)
    renderer.domElement.addEventListener('wheel', onWheel, { passive: true })
    renderer.domElement.addEventListener('pointerdown', onPointerDown)

    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'r') {
        resetView()
      }
    }
    window.addEventListener('keydown', onWindowKeyDown)

    let persistTimer = 0
    const schedulePersist = () => {
      window.clearTimeout(persistTimer)
      persistTimer = window.setTimeout(() => writeWorldCameraState(camera, controls), 180)
    }
    const onControlsChange = () => {
      schedulePersist()
      driftController.notifyUserAction(performance.now())
    }
    controls.addEventListener('change', onControlsChange)

    const driftController = new IdleDriftController({ reduceMotion: reducedMotion }, performance.now())
    driftController.setSelectedId(selectedIdRef.current, performance.now())

    let raf = 0
    const tick = (time: number) => {
      const t = time * 0.001
      driftController.setSelectedId(selectedIdRef.current, time)
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh && bloomLayer.test(object.layers)) {
          const material = object.material
          if (material instanceof THREE.MeshBasicMaterial && typeof object.userData.orbitBaseOpacity === 'number') {
            material.opacity = orbitPulseOpacity(object.userData.orbitBaseOpacity, reducedMotion, t, object.id)
          }
        }
      })
      const driftEnabled = driftController.isEnabled(time)
      planetOrbitStates.forEach((orbitState) => {
        const id = orbitState.mesh.userData.planetId as string
        const pulse = pulseRef.current.get(id) ?? 0
        const scaleBoost = reducedMotion ? 0 : pulse * 0.12 * Math.sin(t * 4.5)
        orbitState.mesh.scale.setScalar(1 + scaleBoost)
        orbitState.mesh.rotation.y += reducedMotion ? 0 : 0.0035
        if (driftEnabled) {
          orbitState.phase += orbitState.driftSpeed * 0.001
          orbitState.mesh.position.set(
            Math.cos(orbitState.phase) * orbitState.orbitRadius,
            orbitState.baseY,
            Math.sin(orbitState.phase) * orbitState.orbitRadius,
          )
        }
      })
      core.rotation.y += reducedMotion ? 0 : 0.004
      const corePulse = reducedMotion ? 0 : (Math.sin(t * 1.4) + 1) * 0.22
      if (core.material instanceof THREE.MeshStandardMaterial) {
        core.material.emissiveIntensity = 0.68 + corePulse
      }
      halo.scale.setScalar(1 + (reducedMotion ? 0 : Math.sin(t * 1.4) * 0.02))
      fresnelShell.rotation.y += reducedMotion ? 0 : 0.0018
      if (!reducedMotion) {
        dust.position.x = Math.sin(t * 0.05) * 0.35
        dust.position.z = Math.cos(t * 0.045) * 0.3
        dust.rotation.y += 0.00035
      }
      controls.update()
      applyHighlight()
      if (import.meta.env.DEV) {
        setDebugState({
          cameraDistance: camera.position.distanceTo(controls.target),
          boundingRadius: computeDebugBoundingRadius(snapshot, planets),
          exposure: renderer.toneMappingExposure,
          overlayAlpha: stormAlpha,
        })
      }
      scene.traverse(darkenNonBloomed)
      composer.render()
      scene.traverse(restoreMaterial)
      raf = window.requestAnimationFrame(tick)
    }
    raf = window.requestAnimationFrame(tick)

    const onResize = () => {
      if (!host) return
      const { clientWidth, clientHeight } = host
      const nextPixelRatio = Math.min(window.devicePixelRatio || 1, 2)
      renderer.setPixelRatio(nextPixelRatio)
      renderer.setSize(clientWidth, clientHeight)
      composer.setPixelRatio(nextPixelRatio)
      composer.setSize(clientWidth, clientHeight)
      fxaaPass.material.uniforms.resolution.value.set(1 / (clientWidth * nextPixelRatio), 1 / (clientHeight * nextPixelRatio))
      camera.aspect = clientWidth / clientHeight
      const nextFit = computeFitToViewState(snapshot, planets, camera.aspect)
      updateControlBounds(nextFit)
      camera.updateProjectionMatrix()
      schedulePersist()
      if (import.meta.env.DEV) {
        setDebugState({
          cameraDistance: camera.position.distanceTo(controls.target),
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
      window.removeEventListener('keydown', onWindowKeyDown)
      window.clearTimeout(persistTimer)
      controls.removeEventListener('change', onControlsChange)
      renderer.domElement.removeEventListener('pointermove', onPointerMove)
      renderer.domElement.removeEventListener('pointerleave', onPointerLeave)
      renderer.domElement.removeEventListener('click', onClick)
      renderer.domElement.removeEventListener('wheel', onWheel)
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      controls.dispose()
      host.removeChild(renderer.domElement)
      renderer.dispose()
      composer.dispose()
      darkMaterial.dispose()
      scene.traverse((obj: THREE.Object3D) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose()
          if (Array.isArray(obj.material)) obj.material.forEach((m: THREE.Material) => m.dispose())
          else obj.material.dispose()
        }
      })
      stars.dispose()
      ibl.dispose()
    }
  }, [devAAMode, devBloomStrength, devExposure, planets, reducedMotion, snapshot, stormAlpha, uiVariant])

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

  const handleResetView = () => {
    resetViewRef.current()
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
        {planets.filter((planet) => visibleLabelIds.has(planet.id)).map((planet) => (
          <span key={`label:${planet.id}`} style={{ left: `${planet.x}px`, top: `${planet.y - planet.radius - 8}px` }}>{planet.labelRu}</span>
        ))}
        {hoveredPlanetLabel && !visibleLabelIds.has(hoveredPlanetLabel.id) ? (
          <span key={`hover:${hoveredPlanetLabel.id}`} style={{ left: `${hoveredPlanetLabel.x}px`, top: `${hoveredPlanetLabel.y - hoveredPlanetLabel.radius - 8}px` }}>{hoveredPlanetLabel.labelRu}</span>
        ) : null}
      </div>
      <button type="button" className="world-webgl__reset-view button-secondary" onClick={handleResetView}>Сброс вида (R)</button>
      {import.meta.env.DEV && debugState ? (
        <div className="world-webgl__debug" data-testid="world-webgl-debug">
          <span>cam {debugState.cameraDistance.toFixed(2)} · r {debugState.boundingRadius.toFixed(2)} · exp {debugState.exposure.toFixed(2)} · α {debugState.overlayAlpha.toFixed(2)}</span>
          <label>
            exp {devExposure.toFixed(2)}
            <input type="range" min={EXPOSURE_RANGE.min} max={EXPOSURE_RANGE.max} step={0.01} value={devExposure} onChange={(event) => setDevExposure(Number(event.target.value))} />
          </label>
          <label>
            bloom {devBloomStrength.toFixed(2)}
            <input type="range" min={0.3} max={1.2} step={0.01} value={devBloomStrength} onChange={(event) => setDevBloomStrength(Number(event.target.value))} />
          </label>
          <label>
            AA
            <select value={devAAMode} onChange={(event) => setDevAAMode(event.target.value as AAMode)}>
              <option value="msaa">msaa</option>
              <option value="fxaa">fxaa</option>
            </select>
          </label>
          <button type="button" className="button-secondary" onClick={handleResetView}>Reset view (R)</button>
        </div>
      ) : null}
    </div>
  )
}
