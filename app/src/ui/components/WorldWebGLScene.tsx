import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react'
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { resolveAAMode, type AAMode } from './worldWebglAAMode'
import type { WorldMapPlanet, WorldMapSnapshot } from '../../core/worldMap/types'
import { computeFitToViewState } from './worldWebglSceneMath'
import type { WorldFxEvent } from '../../pages/worldCockpit'
import { readWorldCameraState, writeWorldCameraState } from './worldWebglCameraState'
import { IdleDriftController } from './worldWebglIdleDrift'
import { createPlanetMaterial, planetMaterialTuningFromPalette, planetPaletteFromId } from './worldWebglPlanetStyle'
import { applySceneEnvironment, collectLightingDiagnostics, createIBL, warnIfLightingInvalid } from './worldWebglLighting'
import { advanceOrbitPhase, buildPlanetOrbitSpec, getOrbitVisualStylePreset, isFlagOn, orbitLocalPoint, relaxOrbitPhases, resolveOrbitVisualState, type OrbitSpec } from './worldWebglOrbits'
import { getWorldScaleSpec } from './worldWebglScaleSpec'
import { getWorldSystemPresetSpec } from './worldWebglSystemPreset'
import { createPlanetPickProxy, findMagnetPlanet, getPlanetVisualScaleForMinPixelRadius, PICK_LAYER, readWorldMinPlanetPixelRadius } from './worldWebglPicking'

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
export const WORLD_WEBGL_LEGACY_RING_ORBITS_ENABLED = false
const BLOOM_PRESETS = {
  soft: { threshold: 1.2, strength: 0.26, radius: 0.24, exposure: 0.92 },
  normal: { threshold: 1.1, strength: 0.35, radius: 0.3, exposure: 1 },
  hot: { threshold: 1.02, strength: 0.48, radius: 0.36, exposure: 1.08 },
} as const

type BloomPresetName = keyof typeof BLOOM_PRESETS

function readBloomPreset(): BloomPresetName {
  const preset = globalThis.localStorage?.getItem('worldBloomPreset')
  if (preset === 'soft' || preset === 'hot') return preset
  return 'normal'
}

const BLOOM_PARAMS = BLOOM_PRESETS[readBloomPreset()]
const EXPOSURE_RANGE = { min: 0.9, max: 1.1 }
const EXPOSURE_DISTANCE_RANGE = { min: 1, max: 1.15 }
const WORLD_SCALE_SPEC = getWorldScaleSpec()
const WORLD_SYSTEM_PRESET = getWorldSystemPresetSpec()
type ExposureMode = 'static' | 'distance'

function readExposureMode(): ExposureMode {
  return globalThis.localStorage?.getItem('worldExposureMode') === 'distance' ? 'distance' : 'static'
}

function readWorldSelectiveBloomEnabled(): boolean {
  return globalThis.localStorage?.getItem('worldSelectiveBloom') === '1'
}

function readWorldOrbitDimEnabled(): boolean {
  return isFlagOn('worldOrbitDim')
}

function readWorldShowAllOrbitsEnabled(): boolean {
  return isFlagOn('worldShowAllOrbits')
}

function readWorldBloomPresetName(): BloomPresetName {
  const preset = globalThis.localStorage?.getItem('worldBloomPreset')
  if (preset === 'soft' || preset === 'hot') return preset
  return 'normal'
}

interface PlanetOrbitState {
  mesh: THREE.Mesh
  orbit: OrbitSpec
  orbitGroup: THREE.Group
  orbitCurve: THREE.EllipseCurve
  driftSpeed: number
  phase: number
}

interface OrbitMaterialDebugState {
  selectedOrbitIndex: number | null
  baseOpacity: number
  baseUniformOpacity: number | null
  selectedOpacity: number
  selectedUniformOpacity: number | null
  selectedGlowVisible: boolean
}


function applyLineMaterialStyle(
  mat: LineMaterial,
  style: { opacity: number; lineWidth: number; colorMultiplier: number; blending: THREE.Blending },
  baseColor: THREE.Color,
): number | null {
  mat.transparent = true
  mat.opacity = style.opacity
  mat.linewidth = style.lineWidth
  mat.blending = style.blending
  mat.color.copy(baseColor).multiplyScalar(style.colorMultiplier)
  const uniformOpacity = mat.uniforms?.opacity
  if (uniformOpacity) {
    uniformOpacity.value = style.opacity
    return uniformOpacity.value as number
  }
  return null
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

const worldDebugIBL = import.meta.env.DEV && globalThis.localStorage?.getItem('worldDebugIBL') === '1'
const worldDebugLighting = import.meta.env.DEV && globalThis.localStorage?.getItem('worldDebugLighting') === '1'
const worldForceUnlitPlanets = globalThis.localStorage?.getItem('worldForceUnlitPlanets') === '1'
const worldNoPost = globalThis.localStorage?.getItem('worldNoPost') === '1'
const worldDebugHUD = isFlagOn('worldDebugHUD')
const worldDebugOrbits = import.meta.env.DEV && globalThis.localStorage?.getItem('worldDebugOrbits') === '1'
const worldOrbitFadeDebug = import.meta.env.DEV && globalThis.localStorage?.getItem('worldOrbitFadeDebug') === '1'
let iblDebugLogged = false



function toneMappingLabel(mode: THREE.ToneMapping): string {
  if (mode === THREE.NoToneMapping) return 'NoToneMapping'
  if (mode === THREE.LinearToneMapping) return 'LinearToneMapping'
  if (mode === THREE.ReinhardToneMapping) return 'ReinhardToneMapping'
  if (mode === THREE.CineonToneMapping) return 'CineonToneMapping'
  if (mode === THREE.ACESFilmicToneMapping) return 'ACESFilmicToneMapping'
  if (mode === THREE.AgXToneMapping) return 'AgXToneMapping'
  if (mode === THREE.NeutralToneMapping) return 'NeutralToneMapping'
  return String(mode)
}
function computeDebugBoundingRadius(snapshot: WorldMapSnapshot, planets: WorldMapPlanet[]): number {
  const maxPlanetRadius = planets.reduce((acc, planet) => {
    const point = toWorldPosition(snapshot, planet)
    return Math.max(acc, point.length())
  }, 0)
  const maxRingRadius = snapshot.rings.reduce((acc, ring) => Math.max(acc, Math.min(ring.radius * 0.045 * WORLD_SCALE_SPEC.orbitRadiusScale * WORLD_SYSTEM_PRESET.orbitRadiusScale, WORLD_SYSTEM_PRESET.maxOrbitRadius)), 0)
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
  const orbitVisualStyle = useMemo(() => getOrbitVisualStylePreset(), [])
  const orbitBaseColor = useMemo(() => new THREE.Color(0x6ca0ff), [])
  const [debugState, setDebugState] = useState<{ cameraDistance: number; boundingRadius: number; exposure: number; overlayAlpha: number; toneMapping: string; outputColorSpace: string; hasEnvironment: boolean; environmentType: string; environmentUuid: string; webglVersion: string; lightCount: number; lights: string; exposureMode: ExposureMode; coreLightIntensity: number; coreLightDistance: number; coreLightDecay: number; fillLightIntensity: number; selectedMesh: string; selectedMaterial: string; selectedColor: string; selectedEmissive: string; selectedMetalness: number; selectedRoughness: number; selectedEnvMapIntensity: number; selectedEmissiveIntensity: number; selectedTransparent: boolean; selectedDepthWrite: boolean; selectedDepthTest: boolean; selectedToneMapped: boolean } | null>(null)
  const [devExposure, setDevExposure] = useState<number>(BLOOM_PARAMS.exposure)
  const [exposureMode] = useState<ExposureMode>(() => readExposureMode())
  const [devBloomStrength, setDevBloomStrength] = useState<number>(BLOOM_PARAMS.strength)
  const [devAAMode, setDevAAMode] = useState<AAMode>('msaa')
  const [selectiveBloomEnabled] = useState<boolean>(() => readWorldSelectiveBloomEnabled())
  const [showAllOrbitsEnabled] = useState<boolean>(() => readWorldShowAllOrbitsEnabled())
  const resetViewRef = useRef<() => void>(() => {})
  const selectedIdRef = useRef<string | null>(selectedPlanetId ?? null)
  const onPlanetSelectRef = useRef(onPlanetSelect)
  const [hoveredPlanetLabel, setHoveredPlanetLabel] = useState<{ id: string; labelRu: string; x: number; y: number; radius: number } | null>(null)
  const [selectedPlanetLabel, setSelectedPlanetLabel] = useState<{ id: string; labelRu: string; x: number; y: number } | null>(null)
  const [orbitMaterialDebugState, setOrbitMaterialDebugState] = useState<OrbitMaterialDebugState | null>(null)
  const [minPlanetPixelRadius] = useState<number>(() => readWorldMinPlanetPixelRadius())

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
    const gl = renderer.getContext()
    const webglVersion = gl.getParameter(gl.VERSION) as string

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
    const renderTarget = new THREE.WebGLRenderTarget(host.clientWidth * pixelRatio, host.clientHeight * pixelRatio, {
      format: THREE.RGBAFormat,
      colorSpace: THREE.SRGBColorSpace,
      samples: activeAAMode === 'msaa' && isWebGL2 ? 4 : 0,
      type: THREE.HalfFloatType,
    })
    const composer = new EffectComposer(renderer, renderTarget)
    composer.setPixelRatio(pixelRatio)
    composer.addPass(new RenderPass(scene, camera))

    const bloomRenderTarget = new THREE.WebGLRenderTarget(host.clientWidth * pixelRatio, host.clientHeight * pixelRatio, {
      format: THREE.RGBAFormat,
      colorSpace: THREE.SRGBColorSpace,
      type: THREE.HalfFloatType,
      samples: 0,
    })
    const bloomComposer = new EffectComposer(renderer, bloomRenderTarget)
    bloomComposer.renderToScreen = false
    bloomComposer.setPixelRatio(pixelRatio)
    const bloomRenderPass = new RenderPass(scene, camera)
    bloomComposer.addPass(bloomRenderPass)
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(host.clientWidth, host.clientHeight), devBloomStrength, BLOOM_PARAMS.radius, BLOOM_PARAMS.threshold)
    bloomComposer.addPass(bloomPass)

    const bloomCompositeMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        bloomTexture: { value: bloomRenderTarget.texture },
      },
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform sampler2D tDiffuse; uniform sampler2D bloomTexture; varying vec2 vUv; void main() { vec4 baseColor = texture2D(tDiffuse, vUv); vec4 bloomColor = texture2D(bloomTexture, vUv); gl_FragColor = baseColor + bloomColor; }`,
    })
    const bloomCompositePass = new ShaderPass(bloomCompositeMaterial)
    composer.addPass(bloomCompositePass)

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
    if (worldDebugIBL && scene.environment && !iblDebugLogged) {
      iblDebugLogged = true
      console.info('[World] IBL initialized', {
        exists: Boolean(scene.environment),
        type: scene.environment.type,
        uuid: scene.environment.uuid,
      })
    }

    const hemi = new THREE.HemisphereLight(0x9cc1ff, 0x071022, 0.16)
    const key = new THREE.DirectionalLight(0xd8e8ff, 0.9)
    key.position.set(12, 10, 7)
    const fill = new THREE.DirectionalLight(0x6effdf, 0.2)
    fill.position.set(-10, 5, 9)
    scene.add(hemi, key, fill)
    if (import.meta.env.DEV) {
      warnIfLightingInvalid(scene)
    }

    const systemGroup = new THREE.Group()
    scene.add(systemGroup)

    const coreGroup = new THREE.Group()
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(1.0 * WORLD_SCALE_SPEC.coreRadiusScale, 64, 64),
      new THREE.MeshStandardMaterial({ color: 0x6baeff, emissive: 0x4bd5ff, emissiveIntensity: 1.18, metalness: 0.06, roughness: 0.58 }),
    )
    const corePointLight = new THREE.PointLight(0x7dbbff, 6.6, 0, 1)
    corePointLight.castShadow = false
    corePointLight.position.set(0, 0, 0)
    const fresnelShell = new THREE.Mesh(
      new THREE.SphereGeometry(1.18 * WORLD_SCALE_SPEC.coreRadiusScale, 64, 64),
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
      new THREE.RingGeometry(1.35 * WORLD_SCALE_SPEC.coreRadiusScale, 1.95 * WORLD_SCALE_SPEC.coreRadiusScale, 96),
      new THREE.MeshBasicMaterial({ color: 0x67ffdb, transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    )
    halo.rotation.x = Math.PI / 2
    coreGroup.add(core, corePointLight, fresnelShell, halo)
    core.layers.enable(BLOOM_LAYER)
    fresnelShell.layers.enable(BLOOM_LAYER)
    halo.layers.enable(BLOOM_LAYER)
    if (snapshot.metrics.safeMode) {
      const shield = new THREE.Mesh(
        new THREE.SphereGeometry(2.08 * WORLD_SCALE_SPEC.coreRadiusScale, 48, 48),
        new THREE.MeshBasicMaterial({ color: 0x6fffd8, transparent: true, opacity: 0.12, wireframe: true }),
      )
      coreGroup.add(shield)
    }
    systemGroup.add(coreGroup)

    const planetMeshes = new Map<string, THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial | THREE.MeshPhysicalMaterial>>()
    const pickProxies = new Map<string, THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>>()
    const orbitByPlanetId = new Map<string, OrbitSpec>()
    const planetOrbitStates: PlanetOrbitState[] = []
    const planetOrbitLines: Array<{ line: Line2; glowLine: Line2; orbitIndex: number; orbitId: string }> = []
    const phaseInputs: Array<{ id: string; orbitRadius: number; planetRadius: number; phase: number }> = []
    const orbitTmp = new THREE.Vector3()
    const orbitNearest = new THREE.Vector3()
    const orbitLocal = new THREE.Vector3()
    const maxPlanetRadius = Math.max(...planets.map((item) => item.radius * 0.042 * WORLD_SCALE_SPEC.planetRadiusScale))
    planets.forEach((planet) => {
      const palette = planetPaletteFromId(planet.id, snapshot.seed)
      const tuning = planetMaterialTuningFromPalette(palette.type, planet)
      const radius = planet.radius * 0.042 * WORLD_SCALE_SPEC.planetRadiusScale
      const material = createPlanetMaterial(palette, tuning, ibl.texture, worldForceUnlitPlanets)
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 36, 36), material)
      mesh.renderOrder = 3
      const orbit = buildPlanetOrbitSpec(
        planet,
        snapshot.seed,
        planet.order,
        radius,
        WORLD_SCALE_SPEC.orbitRadiusScale * WORLD_SYSTEM_PRESET.orbitRadiusScale,
        Math.min(
          (1.9 + planets.length + 2) * WORLD_SCALE_SPEC.orbitRadiusScale * WORLD_SYSTEM_PRESET.orbitRadiusScale,
          WORLD_SYSTEM_PRESET.maxOrbitRadius,
        ),
        { inner: WORLD_SYSTEM_PRESET.innerInclinationMaxDeg, outer: WORLD_SYSTEM_PRESET.outerInclinationMaxDeg },
        {
          coreRadius: 1.95 * WORLD_SCALE_SPEC.coreRadiusScale,
          maxPlanetRadius,
        },
      )
      orbitByPlanetId.set(planet.id, orbit)
      phaseInputs.push({ id: planet.id, orbitRadius: orbit.radiusHint, planetRadius: radius, phase: orbit.phase })
      mesh.userData.planetId = planet.id
      const pickProxy = createPlanetPickProxy(planet.id, radius)

      const orbitGroup = new THREE.Group()
      orbitGroup.rotation.x = orbit.inclination
      orbitGroup.rotation.z = orbit.nodeRotation

      const curvePoints = orbit.curve.getSpacedPoints(ORBIT_SEGMENTS).map((point) => new THREE.Vector3(point.x, 0, point.y))
      const curvePositions = curvePoints.flatMap((point) => [point.x, point.y, point.z])
      const curveGeometry = new LineGeometry()
      curveGeometry.setPositions(curvePositions)
      const baseVisual = resolveOrbitVisualState(orbit.orbitIndex, null)
      const curveMaterial = new LineMaterial({
        color: orbitBaseColor.clone().multiplyScalar(baseVisual.colorMultiplier),
        transparent: true,
        opacity: baseVisual.opacity,
        linewidth: baseVisual.lineWidth,
        blending: THREE.NormalBlending,
        depthWrite: false,
        depthTest: true,
      })
      curveMaterial.resolution.set(host.clientWidth * pixelRatio, host.clientHeight * pixelRatio)
      const orbitLine = new Line2(curveGeometry, curveMaterial)
      orbitLine.computeLineDistances()
      orbitLine.renderOrder = 1

      const glowMaterial = new LineMaterial({
        color: orbitBaseColor.clone(),
        transparent: true,
        opacity: baseVisual.glowOpacity,
        linewidth: baseVisual.lineWidth * 1.2,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
      })
      glowMaterial.resolution.set(host.clientWidth * pixelRatio, host.clientHeight * pixelRatio)
      const glowLine = new Line2(curveGeometry, glowMaterial)
      glowLine.computeLineDistances()
      glowLine.renderOrder = 2

      orbitGroup.add(orbitLine, glowLine, mesh, pickProxy)
      systemGroup.add(orbitGroup)
      planetOrbitLines.push({ line: orbitLine, glowLine, orbitIndex: orbit.orbitIndex, orbitId: orbit.id })

      const speedSeed = seedFloat(snapshot.seed + planet.order * 17 + planet.id.length * 13)
      const driftSpeed = orbit.speed + speedSeed * 0.003
      planetOrbitStates.push({ mesh, orbit, orbitGroup, orbitCurve: orbit.curve, driftSpeed, phase: orbit.phase })
      planetMeshes.set(planet.id, mesh)
      pickProxies.set(planet.id, pickProxy)
    })

    const relaxed = relaxOrbitPhases(phaseInputs, 0.3, 8, WORLD_SCALE_SPEC.minSeparationScale)
    const phaseMap = new Map(relaxed.map((entry) => [entry.id, entry.phase]))
    planetOrbitStates.forEach((state) => {
      const phase = phaseMap.get(state.mesh.userData.planetId as string) ?? state.phase
      state.phase = phase
      orbitLocalPoint(state.orbitCurve, phase, state.mesh.position)
    })

    const worldToLocal = new THREE.Matrix4()
    const devOrbitEpsilon = 1e-3
    const systemWorldPos = new THREE.Vector3()
    const coreWorldPos = new THREE.Vector3()
    const orbitBounds = new THREE.Box2()
    if (worldDebugOrbits) {
      const crossMaterial = new THREE.LineBasicMaterial({ color: 0x00ffaa })
      const crossGeometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-0.2, 0, 0),
        new THREE.Vector3(0.2, 0, 0),
        new THREE.Vector3(0, -0.2, 0),
        new THREE.Vector3(0, 0.2, 0),
        new THREE.Vector3(0, 0, -0.2),
        new THREE.Vector3(0, 0, 0.2),
      ])
      const coreCross = new THREE.LineSegments(crossGeometry, crossMaterial)
      systemGroup.add(coreCross)
      planetOrbitStates.forEach((state) => {
        const orbitCenterCross = new THREE.LineSegments(crossGeometry.clone(), new THREE.LineBasicMaterial({ color: 0xff9c4a }))
        state.orbitGroup.add(orbitCenterCross)
        orbitBounds.makeEmpty()
        state.orbitCurve.getSpacedPoints(ORBIT_SEGMENTS).forEach((point) => orbitBounds.expandByPoint(point))
        const center = orbitBounds.getCenter(new THREE.Vector2())
        if (center.length() > 1e-3) {
          console.warn('[World] Orbit curve center offset from origin', {
            planetId: state.mesh.userData.planetId as string,
            center: center.toArray(),
          })
        }
      })
    }
    const assertPlanetOnOrbit = (state: PlanetOrbitState): void => {
      if (!import.meta.env.DEV) return
      worldToLocal.copy(state.orbitGroup.matrixWorld).invert()
      state.mesh.getWorldPosition(orbitLocal)
      orbitLocal.applyMatrix4(worldToLocal)
      let bestDist = Number.POSITIVE_INFINITY
      const samples = 256
      for (let i = 0; i <= samples; i += 1) {
        orbitLocalPoint(state.orbitCurve, i / samples, orbitTmp)
        const dist = orbitTmp.distanceToSquared(orbitLocal)
        if (dist < bestDist) {
          bestDist = dist
          orbitNearest.copy(orbitTmp)
        }
      }
      const distance = Math.sqrt(bestDist)
      if (distance > devOrbitEpsilon) {
        const planetId = state.mesh.userData.planetId as string
        console.warn('[World] Planet drifted off orbit curve', { planetId, distance, epsilon: devOrbitEpsilon, orbitNearest: orbitNearest.toArray(), orbitLocal: orbitLocal.toArray() })
      }
    }
    const assertSystemCentered = (): void => {
      if (!import.meta.env.DEV) return
      systemGroup.getWorldPosition(systemWorldPos)
      coreGroup.getWorldPosition(coreWorldPos)
      const distance = coreWorldPos.distanceTo(systemWorldPos)
      if (distance > devOrbitEpsilon) {
        console.warn('[World] systemGroup is not centered on core', { distance, epsilon: devOrbitEpsilon })
      }
    }
    const stars = new THREE.BufferGeometry()
    const positions = new Float32Array(360 * 3)
    for (let i = 0; i < 360; i += 1) {
      const spread = 42
      positions[i * 3] = (seedFloat(snapshot.seed + i * 3) - 0.5) * spread
      positions[i * 3 + 1] = (seedFloat(snapshot.seed + i * 5) - 0.5) * spread * 0.5
      positions[i * 3 + 2] = (seedFloat(snapshot.seed + i * 7) - 0.5) * spread
    }
    stars.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const dustCanvas = document.createElement('canvas')
    dustCanvas.width = 32
    dustCanvas.height = 32
    const dustCtx = dustCanvas.getContext('2d')
    if (dustCtx) {
      dustCtx.clearRect(0, 0, 32, 32)
      dustCtx.fillStyle = '#ffffff'
      dustCtx.beginPath()
      dustCtx.arc(16, 16, 14, 0, Math.PI * 2)
      dustCtx.fill()
    }
    const dustTexture = new THREE.CanvasTexture(dustCanvas)
    const dust = new THREE.Points(stars, new THREE.PointsMaterial({ color: 0xb9daff, size: 0.09, map: dustTexture, transparent: true, alphaTest: 0.2, opacity: 0.62, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }))
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
    raycaster.layers.set(PICK_LAYER)
    const pointer = new THREE.Vector2()
    const intersectTargets = [...pickProxies.values()]
    const driftController = new IdleDriftController(
      { reduceMotion: reducedMotion, idleTimeoutMs: import.meta.env.MODE === 'test' ? 0 : undefined },
      performance.now(),
    )
    driftController.setSelectedId(selectedIdRef.current, performance.now())
    let hoveredPlanetId: string | null = null
    const hoveredWorldPosition = new THREE.Vector3()
    const selectedWorldPosition = new THREE.Vector3()
    const projectedSelectedWorldPosition = new THREE.Vector3()
    const applyHighlight = () => {
      planetMeshes.forEach((mesh, id) => {
        const material = mesh.material
        if (!(material instanceof THREE.MeshPhysicalMaterial)) return
        const selectedBoost = selectedIdRef.current === id ? 0.012 : 0
        const hoverBoost = hoveredPlanetId === id ? 0.01 : 0
        const baseEmissive = (material.userData.baseEmissiveIntensity as number ?? 0)
        material.emissiveIntensity = THREE.MathUtils.clamp(baseEmissive + selectedBoost + hoverBoost, 0, 0.08)
      })

      const hoveredMesh = hoveredPlanetId ? planetMeshes.get(hoveredPlanetId) : null
      if (hoveredMesh) {
        hoverRing.visible = true
        hoveredMesh.getWorldPosition(hoveredWorldPosition)
        hoverRing.position.copy(hoveredWorldPosition)
        hoverRing.rotation.x = Math.PI / 2
        hoverRing.scale.setScalar(Math.max(1.1, hoveredMesh.scale.x * 1.1 + 0.1))
      } else {
        hoverRing.visible = false
      }

      const selectedMesh = selectedIdRef.current ? planetMeshes.get(selectedIdRef.current) : null
      if (selectedMesh) {
        selectionRing.visible = true
        selectedMesh.getWorldPosition(selectedWorldPosition)
        selectionRing.position.copy(selectedWorldPosition)
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
      const hits = raycaster.intersectObjects(intersectTargets, true)
      hits.sort((a, b) => a.distance - b.distance)
      const hit = hits[0]
      const directHit = (hit?.object.userData.planetId as string | undefined) ?? null
      if (directHit) return directHit
      const isTouchPointer = 'pointerType' in event && event.pointerType === 'touch'
      const magnetThresholdPx = isTouchPointer ? 36 : 24
      return findMagnetPlanet({
        camera,
        planetMeshes,
        clickX: event.clientX,
        clickY: event.clientY,
        bounds,
        thresholdPx: magnetThresholdPx,
      })
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
      driftController.notifyUserAction(performance.now())
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
      driftController.notifyControlsChange()
      schedulePersist()
    }
    const onControlsStart = () => driftController.notifyControlsStart(performance.now())
    const onControlsEnd = () => undefined
    controls.addEventListener('change', onControlsChange)
    controls.addEventListener('start', onControlsStart)
    controls.addEventListener('end', onControlsEnd)
    let raf = 0
    let lastTickMs: number | null = null
    const tick = (time: number) => {
      const t = time * 0.001
      const deltaMs = lastTickMs == null ? 16.67 : Math.max(0, Math.min(100, time - lastTickMs))
      lastTickMs = time
      driftController.setSelectedId(selectedIdRef.current, time)
      const driftEnabled = !reducedMotion && !selectedIdRef.current
      planetOrbitStates.forEach((orbitState) => {
        const id = orbitState.mesh.userData.planetId as string
        const pulse = pulseRef.current.get(id) ?? 0
        const scaleBoost = reducedMotion ? 0 : pulse * 0.12 * Math.sin(t * 4.5)
        orbitState.mesh.scale.setScalar(1 + scaleBoost)
        orbitState.mesh.rotation.y += reducedMotion ? 0 : 0.0035
        orbitState.phase = advanceOrbitPhase(orbitState.phase, orbitState.driftSpeed, deltaMs, driftEnabled)
        orbitLocalPoint(orbitState.orbitCurve, orbitState.phase, orbitState.mesh.position)
        if (minPlanetPixelRadius > 0) {
          const visualScale = getPlanetVisualScaleForMinPixelRadius(
            camera,
            orbitState.mesh.position.distanceTo(camera.position),
            (orbitState.mesh.geometry as THREE.SphereGeometry).parameters.radius,
            minPlanetPixelRadius,
          )
          orbitState.mesh.scale.setScalar(Math.max(orbitState.mesh.scale.x, visualScale))
        }
        assertPlanetOnOrbit(orbitState)
      })
      assertSystemCentered()
      core.rotation.y += reducedMotion ? 0 : 0.004
      const corePulse = reducedMotion ? 0 : (Math.sin(t * 1.4) + 1) * 0.22
      if (core.material instanceof THREE.MeshStandardMaterial) {
        core.material.emissiveIntensity = 0.68 + corePulse
      }
      corePointLight.intensity = 6.1 + corePulse * 1.4
      const cameraDistance = camera.position.distanceTo(controls.target)
      const farDistance = Math.max(4, computeDebugBoundingRadius(snapshot, planets) * 3.6)
      const exposureBlend = THREE.MathUtils.clamp((cameraDistance - controls.minDistance) / Math.max(0.001, farDistance - controls.minDistance), 0, 1)
      const targetExposure = exposureMode === 'distance'
        ? THREE.MathUtils.lerp(EXPOSURE_DISTANCE_RANGE.min, EXPOSURE_DISTANCE_RANGE.max, exposureBlend)
        : THREE.MathUtils.clamp(devExposure, EXPOSURE_RANGE.min, EXPOSURE_RANGE.max)
      renderer.toneMappingExposure = THREE.MathUtils.lerp(renderer.toneMappingExposure, targetExposure, 0.08)
      halo.scale.setScalar(1 + (reducedMotion ? 0 : Math.sin(t * 1.4) * 0.02))
      fresnelShell.rotation.y += reducedMotion ? 0 : 0.0018
      if (!reducedMotion) {
        dust.position.x = Math.sin(t * 0.05) * 0.35
        dust.position.z = Math.cos(t * 0.045) * 0.3
        dust.rotation.y += 0.00035
      }
      controls.update()
      const selectedOrbitId = selectedIdRef.current
      const selectedOrbitIndex = selectedOrbitId
        ? orbitByPlanetId.get(selectedOrbitId)?.orbitIndex ?? null
        : null
      const orbitDimEnabled = readWorldOrbitDimEnabled()
      const hideNonSelectedOrbits = orbitDimEnabled && Boolean(selectedOrbitId) && !showAllOrbitsEnabled
      let baseOpacity = orbitVisualStyle.baseOrbit.opacity
      let baseUniformOpacity: number | null = null
      let selectedOpacity = orbitVisualStyle.selectedOrbit.opacity
      let selectedUniformOpacity: number | null = null
      let selectedGlowVisible = false
      let hasBaseDebug = false
      planetOrbitLines.forEach(({ line, glowLine, orbitIndex, orbitId }) => {
        const material = line.material as LineMaterial
        const glowMaterial = glowLine.material as LineMaterial
        const visual = resolveOrbitVisualState(orbitIndex, selectedOrbitIndex)
        const opacityUniform = applyLineMaterialStyle(material, visual, orbitBaseColor)
        applyLineMaterialStyle(
          glowMaterial,
          {
            opacity: visual.glowOpacity,
            lineWidth: visual.lineWidth * 1.2,
            colorMultiplier: visual.colorMultiplier,
            blending: THREE.AdditiveBlending,
          },
          orbitBaseColor,
        )

        const isSelectedOrbit = selectedOrbitId != null && orbitId === selectedOrbitId
        if (hideNonSelectedOrbits) {
          line.visible = isSelectedOrbit
          glowLine.visible = isSelectedOrbit
        } else {
          line.visible = true
          glowLine.visible = visual.glowVisible
        }

        if (!isSelectedOrbit && !hasBaseDebug) {
          baseOpacity = visual.opacity
          baseUniformOpacity = opacityUniform
          hasBaseDebug = true
        }
        if (isSelectedOrbit) {
          selectedOpacity = visual.opacity
          selectedUniformOpacity = opacityUniform
          selectedGlowVisible = glowLine.visible
        }
      })
      let nextOrbitMaterialDebugState: OrbitMaterialDebugState | null = null
      nextOrbitMaterialDebugState = {
        selectedOrbitIndex,
        baseOpacity,
        baseUniformOpacity,
        selectedOpacity,
        selectedUniformOpacity,
        selectedGlowVisible,
      }
      setOrbitMaterialDebugState(nextOrbitMaterialDebugState)
      applyHighlight()
      const selectedMeshForLabel = selectedIdRef.current ? planetMeshes.get(selectedIdRef.current) : null
      if (selectedMeshForLabel && selectedIdRef.current) {
        selectedMeshForLabel.getWorldPosition(projectedSelectedWorldPosition)
        projectedSelectedWorldPosition.project(camera)
        const isOutOfFrustum = projectedSelectedWorldPosition.z < -1 || projectedSelectedWorldPosition.z > 1
        if (isOutOfFrustum) {
          setSelectedPlanetLabel(null)
        } else {
          const hostWidth = host.clientWidth
          const hostHeight = host.clientHeight
          const rawX = ((projectedSelectedWorldPosition.x + 1) * 0.5) * hostWidth
          const rawY = ((1 - projectedSelectedWorldPosition.y) * 0.5) * hostHeight - 14
          const x = THREE.MathUtils.clamp(rawX, 32, Math.max(32, hostWidth - 32))
          const y = THREE.MathUtils.clamp(rawY, 18, Math.max(18, hostHeight - 18))
          const planetLabel = planets.find((planet) => planet.id === selectedIdRef.current)
          if (planetLabel) {
            setSelectedPlanetLabel((prev) => {
              if (prev && prev.id === planetLabel.id && Math.abs(prev.x - x) < 0.5 && Math.abs(prev.y - y) < 0.5) return prev
              return { id: planetLabel.id, labelRu: planetLabel.labelRu, x, y }
            })
          } else {
            setSelectedPlanetLabel(null)
          }
        }
      } else {
        setSelectedPlanetLabel(null)
      }
      if (worldDebugHUD || (import.meta.env.DEV && worldDebugLighting) || worldOrbitFadeDebug) {
        const selectedMesh = selectedIdRef.current ? planetMeshes.get(selectedIdRef.current) : null
        const selectedMaterial = selectedMesh?.material
        const diagnostics = collectLightingDiagnostics(scene)
        const lightLines = scene.children
          .filter((item): item is THREE.Light => item instanceof THREE.Light)
          .map((light) => `${light.type}:${light.intensity.toFixed(2)}@${light.position.toArray().map((value) => value.toFixed(2)).join('/')}`)
          .join(' | ')
        setDebugState({
          cameraDistance: camera.position.distanceTo(controls.target),
          boundingRadius: computeDebugBoundingRadius(snapshot, planets),
          exposure: renderer.toneMappingExposure,
          overlayAlpha: stormAlpha,
          toneMapping: toneMappingLabel(renderer.toneMapping),
          outputColorSpace: String(renderer.outputColorSpace),
          hasEnvironment: diagnostics.environment.exists,
          environmentType: diagnostics.environment.type ?? 'n/a',
          environmentUuid: diagnostics.environment.uuid ?? 'n/a',
          webglVersion,
          lightCount: diagnostics.lightCount,
          lights: lightLines,
          exposureMode,
          coreLightIntensity: corePointLight.intensity,
          coreLightDistance: corePointLight.distance,
          coreLightDecay: corePointLight.decay,
          fillLightIntensity: hemi.intensity,
          selectedMesh: selectedMesh ? `${selectedMesh.name || 'planet'}#${selectedMesh.id}` : 'n/a',
          selectedMaterial: selectedMaterial?.type ?? 'n/a',
          selectedColor: selectedMaterial instanceof THREE.MeshBasicMaterial || selectedMaterial instanceof THREE.MeshPhysicalMaterial ? selectedMaterial.color.getHexString() : 'n/a',
          selectedEmissive: selectedMaterial instanceof THREE.MeshPhysicalMaterial ? selectedMaterial.emissive.getHexString() : 'n/a',
          selectedMetalness: selectedMaterial instanceof THREE.MeshPhysicalMaterial ? selectedMaterial.metalness : 0,
          selectedRoughness: selectedMaterial instanceof THREE.MeshPhysicalMaterial ? selectedMaterial.roughness : 0,
          selectedEnvMapIntensity: selectedMaterial instanceof THREE.MeshPhysicalMaterial ? selectedMaterial.envMapIntensity : 0,
          selectedEmissiveIntensity: selectedMaterial instanceof THREE.MeshPhysicalMaterial ? selectedMaterial.emissiveIntensity : 0,
          selectedTransparent: Boolean(selectedMaterial?.transparent),
          selectedDepthWrite: Boolean(selectedMaterial?.depthWrite),
          selectedDepthTest: Boolean(selectedMaterial?.depthTest),
          selectedToneMapped: Boolean(selectedMaterial?.toneMapped),
        })
      }
      bloomPass.threshold = BLOOM_PARAMS.threshold
      bloomPass.radius = BLOOM_PARAMS.radius
      bloomPass.strength = devBloomStrength
      if (worldNoPost) {
        renderer.render(scene, camera)
      } else if (selectiveBloomEnabled) {
        const prevMask = camera.layers.mask
        camera.layers.set(BLOOM_LAYER)
        bloomComposer.render()
        camera.layers.mask = prevMask
        composer.render()
      } else {
        bloomComposer.render()
        composer.render()
      }
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
      bloomComposer.setPixelRatio(nextPixelRatio)
      bloomComposer.setSize(clientWidth, clientHeight)
      bloomPass.setSize(clientWidth, clientHeight)
      fxaaPass.material.uniforms.resolution.value.set(1 / (clientWidth * nextPixelRatio), 1 / (clientHeight * nextPixelRatio))
      planetOrbitLines.forEach(({ line, glowLine }) => {
        const material = line.material as LineMaterial
        const glowMaterial = glowLine.material as LineMaterial
        material.resolution.set(clientWidth * nextPixelRatio, clientHeight * nextPixelRatio)
        glowMaterial.resolution.set(clientWidth * nextPixelRatio, clientHeight * nextPixelRatio)
      })
      camera.aspect = clientWidth / clientHeight
      const nextFit = computeFitToViewState(snapshot, planets, camera.aspect)
      updateControlBounds(nextFit)
      camera.updateProjectionMatrix()
      schedulePersist()
    }
    window.addEventListener('resize', onResize)

    return () => {
      window.cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('keydown', onWindowKeyDown)
      window.clearTimeout(persistTimer)
      controls.removeEventListener('change', onControlsChange)
      controls.removeEventListener('start', onControlsStart)
      controls.removeEventListener('end', onControlsEnd)
      renderer.domElement.removeEventListener('pointermove', onPointerMove)
      renderer.domElement.removeEventListener('pointerleave', onPointerLeave)
      renderer.domElement.removeEventListener('click', onClick)
      renderer.domElement.removeEventListener('wheel', onWheel)
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      controls.dispose()
      host.removeChild(renderer.domElement)
      renderer.dispose()
      composer.dispose()
      bloomComposer.dispose()
      bloomRenderTarget.dispose()
      planetOrbitLines.forEach(({ line, glowLine }) => {
        line.geometry.dispose()
        const material = line.material as LineMaterial
        material.dispose()
        const glowMaterial = glowLine.material as LineMaterial
        glowMaterial.dispose()
      })
      scene.traverse((obj: THREE.Object3D) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose()
          if (Array.isArray(obj.material)) obj.material.forEach((m: THREE.Material) => m.dispose())
          else obj.material.dispose()
        }
      })
      stars.dispose()
      dustTexture.dispose()
      ibl.dispose()
    }
  }, [
    devAAMode,
    devBloomStrength,
    devExposure,
    exposureMode,
    orbitBaseColor,
    orbitVisualStyle.baseLineWidth,
    orbitVisualStyle.baseOrbit.opacity,
    orbitVisualStyle.baseOrbit.lineWidthScale,
    orbitVisualStyle.nearOrbit.opacity,
    orbitVisualStyle.nearOrbit.lineWidthScale,
    orbitVisualStyle.selectedOrbit.opacity,
    orbitVisualStyle.selectedOrbit.lineWidthScale,
    planets,
    reducedMotion,
    minPlanetPixelRadius,
    snapshot,
    selectiveBloomEnabled,
    showAllOrbitsEnabled,
    stormAlpha,
    uiVariant,
  ])

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
        {selectedPlanetLabel ? (
          <span key={`label:selected:${selectedPlanetLabel.id}`} className="world-webgl__label--selected" style={{ left: `${selectedPlanetLabel.x}px`, top: `${selectedPlanetLabel.y}px` }}>{selectedPlanetLabel.labelRu}</span>
        ) : null}
        {hoveredPlanetLabel ? (
          <span key={`hover:${hoveredPlanetLabel.id}`} className="world-webgl__label--hover" style={{ left: `${hoveredPlanetLabel.x}px`, top: `${hoveredPlanetLabel.y - hoveredPlanetLabel.radius - 8}px` }}>{hoveredPlanetLabel.labelRu}</span>
        ) : null}
      </div>
      <button type="button" className="world-webgl__reset-view button-secondary" onClick={handleResetView}>Сброс вида (R)</button>
      <div className="world-webgl__orbit-chip" aria-live="polite">
        <span>OrbitDim {readWorldOrbitDimEnabled() ? 'ON' : 'OFF'}</span>
        <span>worldOrbitDim raw:{globalThis.localStorage?.getItem('worldOrbitDim') ?? 'null'}</span>
        <span>selectedPlanetId {selectedId ?? 'none'}</span>
        <span>ShowAllOrbits {showAllOrbitsEnabled ? 'ON' : 'OFF'}</span>
        <span>SelectiveBloom {readWorldSelectiveBloomEnabled() ? 'ON' : 'OFF'}</span>
        <span>BloomPreset {readWorldBloomPresetName()}</span>
        <span>base o:{orbitVisualStyle.baseOrbit.opacity.toFixed(2)} lw×{orbitVisualStyle.baseOrbit.lineWidthScale.toFixed(2)} rgb×{orbitVisualStyle.baseOrbit.colorMultiplier.toFixed(2)} g:{orbitVisualStyle.baseOrbit.glowOpacity.toFixed(2)}</span>
        <span>sel o:{orbitVisualStyle.selectedOrbit.opacity.toFixed(2)} lw×{orbitVisualStyle.selectedOrbit.lineWidthScale.toFixed(2)} rgb×{orbitVisualStyle.selectedOrbit.colorMultiplier.toFixed(2)} g:{orbitVisualStyle.selectedOrbit.glowOpacity.toFixed(2)}</span>
        <span>
          base uniforms.opacity {orbitMaterialDebugState?.baseUniformOpacity == null ? 'n/a' : orbitMaterialDebugState.baseUniformOpacity.toFixed(2)} ·
          base mat.opacity {orbitMaterialDebugState?.baseOpacity.toFixed(2) ?? 'n/a'}
        </span>
        <span>
          sel uniforms.opacity {orbitMaterialDebugState?.selectedUniformOpacity == null ? 'n/a' : orbitMaterialDebugState.selectedUniformOpacity.toFixed(2)} ·
          sel mat.opacity {orbitMaterialDebugState?.selectedOpacity.toFixed(2) ?? 'n/a'} ·
          sel glow {orbitMaterialDebugState?.selectedGlowVisible ? 'on' : 'off'} ·
          selIdx {orbitMaterialDebugState?.selectedOrbitIndex ?? 'none'}
        </span>
      </div>
      {(worldDebugHUD || (import.meta.env.DEV && worldDebugLighting) || worldOrbitFadeDebug) && debugState ? (
        <div className="world-webgl__debug" data-testid="world-webgl-debug">
          <span>gl {debugState.webglVersion}</span>
          <span>cam {debugState.cameraDistance.toFixed(2)} · r {debugState.boundingRadius.toFixed(2)} · exp {debugState.exposure.toFixed(2)} · α {debugState.overlayAlpha.toFixed(2)}</span>
          <span>tm {debugState.toneMapping} · cs {debugState.outputColorSpace}</span>
          <span>env {String(debugState.hasEnvironment)} ({debugState.environmentType}) · {debugState.environmentUuid}</span>
          <span>lights {debugState.lightCount} · {debugState.lights}</span>
          <span>expMode {debugState.exposureMode} · core i {debugState.coreLightIntensity.toFixed(2)} d {debugState.coreLightDistance.toFixed(2)} decay {debugState.coreLightDecay.toFixed(2)} · fill {debugState.fillLightIntensity.toFixed(2)}</span>
          <span>sel {debugState.selectedMesh} · {debugState.selectedMaterial} · #{debugState.selectedColor} · em #{debugState.selectedEmissive}</span>
          <span>m {debugState.selectedMetalness.toFixed(2)} · r {debugState.selectedRoughness.toFixed(2)} · env {debugState.selectedEnvMapIntensity.toFixed(2)} · ei {debugState.selectedEmissiveIntensity.toFixed(2)}</span>
          <span>flags t:{String(debugState.selectedTransparent)} dw:{String(debugState.selectedDepthWrite)} dt:{String(debugState.selectedDepthTest)} tm:{String(debugState.selectedToneMapped)}</span>
          {worldOrbitFadeDebug ? (
            <span>
              orbitFade base o:{orbitVisualStyle.baseOrbit.opacity.toFixed(2)} lw×{orbitVisualStyle.baseOrbit.lineWidthScale.toFixed(2)} rgb×{orbitVisualStyle.baseOrbit.colorMultiplier.toFixed(2)} ·
              near o:{orbitVisualStyle.nearOrbit.opacity.toFixed(2)} lw×{orbitVisualStyle.nearOrbit.lineWidthScale.toFixed(2)} rgb×{orbitVisualStyle.nearOrbit.colorMultiplier.toFixed(2)} ·
              sel o:{orbitVisualStyle.selectedOrbit.opacity.toFixed(2)} lw×{orbitVisualStyle.selectedOrbit.lineWidthScale.toFixed(2)} rgb×{orbitVisualStyle.selectedOrbit.colorMultiplier.toFixed(2)} · inner idx:0/1
            </span>
          ) : null}
          {import.meta.env.DEV ? (
            <>
              <label>
                exp {devExposure.toFixed(2)}
                <input type="range" min={EXPOSURE_RANGE.min} max={EXPOSURE_RANGE.max} step={0.01} value={devExposure} onChange={(event) => setDevExposure(Number(event.target.value))} />
              </label>
              <label>
                bloom {devBloomStrength.toFixed(2)}
                <input type="range" min={0.2} max={0.45} step={0.01} value={devBloomStrength} onChange={(event) => setDevBloomStrength(Number(event.target.value))} />
              </label>
              <label>
                AA
                <select value={devAAMode} onChange={(event) => setDevAAMode(event.target.value as AAMode)}>
                  <option value="msaa">msaa</option>
                  <option value="fxaa">fxaa</option>
                </select>
              </label>
            </>
          ) : null}
          <button type="button" className="button-secondary" onClick={handleResetView}>Reset view (R)</button>
        </div>
      ) : null}
    </div>
  )
}
