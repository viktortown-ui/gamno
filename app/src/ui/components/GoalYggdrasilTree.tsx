import { hierarchy, tree } from 'd3-hierarchy'
import { select } from 'd3-selection'
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export type BranchStrength = 'weak' | 'normal' | 'strong'

export interface YggdrasilMissionLeaf {
  id: string
  title: string
  done?: boolean
}

export interface YggdrasilBranch {
  id: string
  title: string
  direction: 'up' | 'down'
  rune: 'I' | 'II' | 'III' | 'IV' | 'V'
  strength: BranchStrength
  priorityBand: 'low' | 'medium' | 'high'
  isTopPriority?: boolean
  isWeak?: boolean
  missionEffectCores: { min: number; max: number }
  missionEffectExpected?: number
  missionDayLabel?: string
  missions: YggdrasilMissionLeaf[]
}

interface Props {
  objective: string
  branches: YggdrasilBranch[]
  selectedBranchId: string | null
  onSelectBranch: (branchId: string) => void
  resetSignal?: number
}

interface TreeHierarchyNode {
  id: string
  kind: 'objective' | 'kr'
  title: string
  strength?: BranchStrength
  direction?: 'up' | 'down'
  priorityBand?: 'low' | 'medium' | 'high'
  isTopPriority?: boolean
  isWeak?: boolean
  missionEffectCores?: { min: number; max: number }
  missionEffectExpected?: number
  missionDayLabel?: string
  children?: TreeHierarchyNode[]
}

const DEFAULT_SCENE_WIDTH = 900
const DEFAULT_SCENE_HEIGHT = 560
const FIT_PADDING = 40
const RIBBON_SEGMENTS = 44

function hashSeed(input: string): number {
  let hash = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash >>> 0)
}

function branchPath(sourceX: number, sourceY: number, targetX: number, targetY: number, sway = 0): string {
  const dx = targetX - sourceX
  const dy = targetY - sourceY
  const bend = Math.max(34, Math.abs(dy) * 0.45)
  return `M${sourceX},${sourceY} C${sourceX + dx * (0.2 + sway * 0.04)},${sourceY - bend * (0.9 + sway * 0.2)} ${targetX - dx * (0.24 - sway * 0.03)},${targetY + bend * (0.42 + sway * 0.1)} ${targetX},${targetY}`
}

interface CubicCurve {
  p0: { x: number; y: number }
  p1: { x: number; y: number }
  p2: { x: number; y: number }
  p3: { x: number; y: number }
}

function branchCurve(sourceX: number, sourceY: number, targetX: number, targetY: number, sway = 0): CubicCurve {
  const dx = targetX - sourceX
  const dy = targetY - sourceY
  const bend = Math.max(34, Math.abs(dy) * 0.45)
  return {
    p0: { x: sourceX, y: sourceY },
    p1: { x: sourceX + dx * (0.2 + sway * 0.04), y: sourceY - bend * (0.9 + sway * 0.2) },
    p2: { x: targetX - dx * (0.24 - sway * 0.03), y: targetY + bend * (0.42 + sway * 0.1) },
    p3: { x: targetX, y: targetY },
  }
}

function cubicPoint(curve: CubicCurve, t: number) {
  const mt = 1 - t
  const a = mt * mt * mt
  const b = 3 * mt * mt * t
  const c = 3 * mt * t * t
  const d = t * t * t
  return {
    x: a * curve.p0.x + b * curve.p1.x + c * curve.p2.x + d * curve.p3.x,
    y: a * curve.p0.y + b * curve.p1.y + c * curve.p2.y + d * curve.p3.y,
  }
}

function cubicDerivative(curve: CubicCurve, t: number) {
  const mt = 1 - t
  return {
    x: 3 * mt * mt * (curve.p1.x - curve.p0.x) + 6 * mt * t * (curve.p2.x - curve.p1.x) + 3 * t * t * (curve.p3.x - curve.p2.x),
    y: 3 * mt * mt * (curve.p1.y - curve.p0.y) + 6 * mt * t * (curve.p2.y - curve.p1.y) + 3 * t * t * (curve.p3.y - curve.p2.y),
  }
}

function makeRibbonPath(curve: CubicCurve, widthStart: number, widthEnd: number, segments = RIBBON_SEGMENTS): string {
  const left: string[] = []
  const right: string[] = []

  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments
    const point = cubicPoint(curve, t)
    const tangent = cubicDerivative(curve, t)
    const tangentLength = Math.hypot(tangent.x, tangent.y) || 1
    const nx = -tangent.y / tangentLength
    const ny = tangent.x / tangentLength
    const width = widthStart + (widthEnd - widthStart) * t
    const half = width / 2
    left.push(`${point.x + nx * half},${point.y + ny * half}`)
    right.push(`${point.x - nx * half},${point.y - ny * half}`)
  }

  return `M${left.join(' L')} L${right.reverse().join(' L')} Z`
}

function truncateLabel(value: string, max = 22): string {
  if (value.length <= max) return value
  return `${value.slice(0, max - 1).trimEnd()}…`
}

export function GoalYggdrasilTree({ objective, branches, selectedBranchId, onSelectBranch, resetSignal = 0 }: Props) {
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity)
  const [viewSize, setViewSize] = useState({ width: DEFAULT_SCENE_WIDTH, height: DEFAULT_SCENE_HEIGHT })
  const [isMobile, setIsMobile] = useState(false)
  const [hoveredBranchId, setHoveredBranchId] = useState<string | null>(null)
  const sceneRef = useRef<SVGSVGElement | null>(null)
  const sceneWrapRef = useRef<HTMLDivElement | null>(null)
  const treeViewportRef = useRef<SVGGElement | null>(null)
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null)

  const sceneBranches = branches.slice(0, 5)
  const fallbackObjective = objective || 'Уточните цель в Кузнице.'

  useEffect(() => {
    if (!sceneWrapRef.current || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const width = Math.max(320, Math.round(entry.contentRect.width))
      const height = Math.max(320, Math.round(entry.contentRect.height))
      setViewSize({ width, height })
    })

    observer.observe(sceneWrapRef.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return

    const mobileQuery = window.matchMedia('(max-width: 860px), (pointer: coarse)')
    const update = () => {
      setIsMobile(mobileQuery.matches)
    }

    update()
    mobileQuery.addEventListener('change', update)

    return () => {
      mobileQuery.removeEventListener('change', update)
    }
  }, [])

  const layout = useMemo(() => {
    const treeData = hierarchy<TreeHierarchyNode>({
      id: 'root',
      kind: 'objective',
      title: fallbackObjective,
      children: sceneBranches.map((branch) => ({
        id: branch.id,
        kind: 'kr',
        title: branch.title,
        strength: branch.strength,
        direction: branch.direction,
        priorityBand: branch.priorityBand,
        isTopPriority: branch.isTopPriority,
        isWeak: branch.isWeak,
        missionEffectCores: branch.missionEffectCores,
        missionEffectExpected: branch.missionEffectExpected,
        missionDayLabel: branch.missionDayLabel,
      })),
    })

    const horizontalPadding = Math.max(42, Math.min(110, viewSize.width * 0.11))
    const verticalPadding = Math.max(26, Math.min(72, viewSize.height * 0.11))
    const tidyTree = tree<TreeHierarchyNode>()
      .size([Math.max(220, viewSize.width - horizontalPadding * 2), Math.max(280, viewSize.height - verticalPadding * 2)])
      .separation((a, b) => (a.parent === b.parent ? 1.45 : 1.75))

    const root = tidyTree(treeData)
    const trunkY = viewSize.height * 0.84
    const crownTop = viewSize.height * 0.14
    const crownBottom = viewSize.height * 0.42
    const span = Math.max(1, (root.children?.length ?? 1) - 1)

    root.descendants().forEach((node) => {
      if (node.depth === 0) {
        node.x = viewSize.width / 2
        node.y = trunkY
        return
      }

      const idx = node.parent?.children?.findIndex((child) => child.data.id === node.data.id) ?? 0
      const lane = span === 0 ? 0 : idx / span
      const sway = lane - 0.5
      node.x = horizontalPadding + lane * (viewSize.width - horizontalPadding * 2) + sway * 48
      const verticalShift = Math.abs(sway) * 0.16
      node.y = crownBottom - (crownBottom - crownTop) * (0.6 + verticalShift)
    })

    return { root }
  }, [fallbackObjective, sceneBranches, viewSize.height, viewSize.width])

  const rootNode = layout.root
  const krNodes = layout.root.children ?? []

  const runFitToView = useCallback(() => {
    if (!sceneRef.current || !treeViewportRef.current || !zoomRef.current) return

    const viewportBounds = sceneRef.current.getBoundingClientRect()
    const bbox = treeViewportRef.current.getBBox()
    if (bbox.width === 0 || bbox.height === 0 || viewportBounds.width === 0 || viewportBounds.height === 0) return

    const availableWidth = Math.max(10, viewportBounds.width - FIT_PADDING * 2)
    const availableHeight = Math.max(10, viewportBounds.height - FIT_PADDING * 2)
    const scale = Math.max(0.6, Math.min(2.5, Math.min(availableWidth / bbox.width, availableHeight / bbox.height)))
    const viewportCenterX = viewportBounds.width / 2
    const viewportCenterY = viewportBounds.height / 2
    const bboxCenterX = bbox.x + bbox.width / 2
    const bboxCenterY = bbox.y + bbox.height / 2
    const translateX = viewportCenterX - bboxCenterX * scale
    const translateY = viewportCenterY - bboxCenterY * scale

    const target = zoomIdentity.translate(translateX, translateY).scale(scale)
    const selection = select(sceneRef.current)

    selection.call(zoomRef.current.transform, target)
  }, [])

  const resetView = useCallback(() => {
    runFitToView()
  }, [runFitToView])

  const focusTrunk = useCallback(() => {
    if (!sceneRef.current || !zoomRef.current) return
    const centerX = viewSize.width / 2
    const centerY = viewSize.height * 0.62
    const targetScale = Math.max(1, Math.min(1.55, transform.k * 1.08))
    const targetX = centerX - rootNode.x * targetScale
    const targetY = centerY - rootNode.y * targetScale
    const nextTransform = zoomIdentity.translate(targetX, targetY).scale(targetScale)
    const selection = select(sceneRef.current)
    selection.call(zoomRef.current.transform, nextTransform)
  }, [rootNode.x, rootNode.y, transform.k, viewSize.height, viewSize.width])

  useEffect(() => {
    if (!sceneRef.current) return

    const behavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.6, 2.5])
      .translateExtent([
        [-viewSize.width * 0.45, -viewSize.height * 0.45],
        [viewSize.width * 1.45, viewSize.height * 1.45],
      ])
      .on('zoom', (event) => {
        setTransform(event.transform)
      })

    zoomRef.current = behavior
    const selection = select(sceneRef.current)
    selection.call(behavior)
    requestAnimationFrame(() => {
      runFitToView()
    })

    return () => {
      selection.on('.zoom', null)
    }
  }, [runFitToView, viewSize.height, viewSize.width])

  useEffect(() => {
    runFitToView()
  }, [runFitToView, fallbackObjective, sceneBranches.length, viewSize.height, viewSize.width])

  useEffect(() => {
    if (resetSignal > 0) {
      resetView()
    }
  }, [resetSignal, resetView])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'r') {
        event.preventDefault()
        resetView()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [resetView])

  return (
    <div className="goal-yggdrasil">
      <div className="goal-yggdrasil__head">
        <h2>Иггдрасиль</h2>
      </div>
      <p className="goal-yggdrasil__objective"><strong>Objective:</strong> {fallbackObjective}</p>
      <div className="goal-yggdrasil__scene" aria-label="Сцена Иггдрасиля" ref={sceneWrapRef}>
        <div className="goal-yggdrasil__floating-controls" role="toolbar" aria-label="Управление сценой">
          <button type="button" className="filter-button" onClick={resetView} aria-label="Сброс вида">{isMobile ? '↺' : 'Сброс вида (R)'}</button>
          <button type="button" className="filter-button" onClick={focusTrunk} aria-label="Фокус на стволе">{isMobile ? '◎' : 'Фокус на стволе'}</button>
        </div>
        <svg ref={sceneRef} viewBox={`0 0 ${viewSize.width} ${viewSize.height}`} role="img" aria-label="Дерево Objective и KR ветвей">
          <defs>
            <linearGradient id="trunkGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(154, 117, 91, 0.94)" />
              <stop offset="52%" stopColor="rgba(103, 74, 54, 0.98)" />
              <stop offset="100%" stopColor="rgba(48, 31, 24, 0.98)" />
            </linearGradient>
            <linearGradient id="branchWeak" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="rgba(255, 177, 173, 0.94)" />
              <stop offset="100%" stopColor="rgba(247, 126, 126, 0.56)" />
            </linearGradient>
            <linearGradient id="branchNormal" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="rgba(179, 204, 255, 0.95)" />
              <stop offset="100%" stopColor="rgba(97, 156, 255, 0.58)" />
            </linearGradient>
            <linearGradient id="branchStrong" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="rgba(182, 255, 222, 0.95)" />
              <stop offset="100%" stopColor="rgba(92, 224, 174, 0.58)" />
            </linearGradient>
            <filter id="nodeGlow" x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id="branchShadow" x="-30%" y="-30%" width="160%" height="160%">
              <feDropShadow dx="0" dy="2" stdDeviation="4.5" floodColor="rgba(7, 10, 20, 0.52)" />
            </filter>
            <filter id="branchGlow" x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="3" result="soft" />
              <feMerge>
                <feMergeNode in="soft" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <radialGradient id="budWeak" cx="32%" cy="28%" r="70%">
              <stop offset="0%" stopColor="rgba(255, 244, 242, 0.98)" />
              <stop offset="100%" stopColor="rgba(237, 117, 117, 0.92)" />
            </radialGradient>
            <radialGradient id="budNormal" cx="32%" cy="28%" r="70%">
              <stop offset="0%" stopColor="rgba(241, 250, 255, 0.98)" />
              <stop offset="100%" stopColor="rgba(98, 152, 255, 0.92)" />
            </radialGradient>
            <radialGradient id="budStrong" cx="32%" cy="28%" r="70%">
              <stop offset="0%" stopColor="rgba(238, 255, 247, 0.98)" />
              <stop offset="100%" stopColor="rgba(86, 223, 170, 0.94)" />
            </radialGradient>
            <radialGradient id="leafWeak" cx="45%" cy="36%" r="74%">
              <stop offset="0%" stopColor="rgba(255, 233, 231, 0.92)" />
              <stop offset="100%" stopColor="rgba(235, 127, 127, 0.78)" />
            </radialGradient>
            <radialGradient id="leafNormal" cx="45%" cy="36%" r="74%">
              <stop offset="0%" stopColor="rgba(236, 248, 255, 0.92)" />
              <stop offset="100%" stopColor="rgba(130, 178, 255, 0.78)" />
            </radialGradient>
            <radialGradient id="leafStrong" cx="45%" cy="36%" r="74%">
              <stop offset="0%" stopColor="rgba(233, 255, 247, 0.92)" />
              <stop offset="100%" stopColor="rgba(102, 229, 181, 0.82)" />
            </radialGradient>
            <filter id="leafGlow" x="-55%" y="-55%" width="210%" height="210%">
              <feGaussianBlur stdDeviation="2.2" result="soft" />
              <feMerge>
                <feMergeNode in="soft" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <g transform={transform.toString()}>
            <g className="tree-viewport" ref={treeViewportRef}>
              <path
                d={makeRibbonPath(
                  branchCurve(rootNode.x, viewSize.height - 12, rootNode.x, rootNode.y + 18),
                  38,
                  20,
                )}
                className="goal-yggdrasil__trunk"
              />

              {krNodes.map((krNode) => {
                if (krNode.data.kind !== 'kr' || !krNode.data.strength) return null
                const branch = krNode.data
                const isSelected = selectedBranchId === branch.id
                const isDimmed = selectedBranchId !== null && !isSelected
                const showLabel = !isMobile || isSelected
                const sway = ((hashSeed(branch.id) % 100) / 100 - 0.5) * 1.6
                const curve = branchCurve(rootNode.x, rootNode.y + 14, krNode.x, krNode.y, sway)
                const centerPath = branchPath(rootNode.x, rootNode.y + 14, krNode.x, krNode.y, sway)
                const branchBaseWidth = branch.strength === 'strong' ? 17 : branch.strength === 'normal' ? 14 : 11
                const branchWidthScale = branch.priorityBand === 'high' ? 1.2 : branch.priorityBand === 'medium' ? 1 : 0.8
                const ribbonPath = makeRibbonPath(curve, branchBaseWidth * 1.35 * branchWidthScale, branchBaseWidth * 0.78 * branchWidthScale)
                const particleCount = 10 + (hashSeed(`${branch.id}-leaf-count`) % 21)
                const isHovered = hoveredBranchId === branch.id
                const showEffectHint = (isSelected || isHovered) && branch.missionEffectCores
                const particles = Array.from({ length: particleCount }, (_, index) => {
                  const seed = hashSeed(`${branch.id}-${index}`)
                  const angle = (seed % 360) * (Math.PI / 180)
                  const radius = 12 + (seed % 36)
                  const x = Math.cos(angle) * radius * (1.05 + ((seed >> 3) % 12) / 28)
                  const y = Math.sin(angle) * radius * (0.78 + ((seed >> 7) % 10) / 22)
                  const size = 2 + ((seed >> 11) % 8) * 0.44
                  return { x, y, size }
                })

                return (
                  <g
                    key={branch.id}
                    className={`goal-yggdrasil__branch-group ${isSelected ? 'goal-yggdrasil__branch-group--selected' : ''} ${isDimmed ? 'goal-yggdrasil__branch-group--dimmed' : ''}`}
                    onMouseEnter={() => setHoveredBranchId(branch.id)}
                    onMouseLeave={() => setHoveredBranchId((current) => (current === branch.id ? null : current))}
                  >
                    <path
                      d={ribbonPath}
                      className={`goal-yggdrasil__branch goal-yggdrasil__branch--${branch.strength} ${isSelected ? 'goal-yggdrasil__branch--selected' : ''}`}
                    />
                    <path d={centerPath} className={`goal-yggdrasil__branch-sheen ${isSelected ? 'goal-yggdrasil__branch-sheen--selected' : ''}`} />
                    <g transform={`translate(${krNode.x}, ${krNode.y})`}>
                      <g className={`goal-yggdrasil__leaf-cluster goal-yggdrasil__leaf-cluster--${branch.strength}`}>
                        {particles.map((particle) => (
                          <circle
                            key={`${branch.id}-${particle.x}-${particle.y}`}
                            cx={particle.x}
                            cy={particle.y}
                            r={particle.size}
                            className="goal-yggdrasil__leaf-particle"
                          />
                        ))}
                      </g>
                      <circle className="goal-yggdrasil__node-hit" r="22" onClick={() => onSelectBranch(branch.id)} />
                      <circle
                        className={`goal-yggdrasil__priority-halo goal-yggdrasil__priority-halo--${branch.priorityBand}`}
                        r="24"
                      />
                      <circle className={`goal-yggdrasil__node-halo goal-yggdrasil__node-halo--${branch.strength} goal-yggdrasil__node-halo--priority-${branch.priorityBand}`} r="17" />
                      <path
                        d="M-2,-11 C7,-10 13,-3 10,6 C7,14 -5,14 -11,8 C-15,3 -12,-6 -2,-11 Z"
                        className={`goal-yggdrasil__node-core goal-yggdrasil__node-core--${branch.strength} ${isSelected ? 'goal-yggdrasil__node-core--selected' : ''}`}
                        filter="url(#nodeGlow)"
                      />
                      {sceneBranches.find((item) => item.id === branch.id)?.missions.length ? <circle cx="14" cy="-14" r="5" className="goal-yggdrasil__mission-fruit" /> : null}
                      {sceneBranches.find((item) => item.id === branch.id)?.missions.length && branch.missionDayLabel ? (
                        <text x="20" y="-16" className="goal-yggdrasil__mission-day">{branch.missionDayLabel}</text>
                      ) : null}
                      {branch.isWeak ? (
                        <g className="goal-yggdrasil__weak-mark" transform="translate(-20, -18)">
                          <circle r="8" />
                          <path d="M-2,-5 L1,-1 L-1,1 L2,5" />
                        </g>
                      ) : null}
                      {branch.isWeak ? <path d="M-16,-5 L-7,-10 L-10,-2 L-3,3" className="goal-yggdrasil__weak-crack" /> : null}
                      {showEffectHint && branch.missionEffectCores ? (
                        <g className="goal-yggdrasil__effect-hint" transform="translate(26, 14)">
                          <rect x="0" y="-21" width="226" height="32" rx="8" />
                          <text x="8" y="-2">Если выполнить миссию: +{branch.missionEffectCores.min}…{branch.missionEffectCores.max} ядер</text>
                          <text x="8" y="10" className="goal-yggdrasil__effect-hint-sub">обычно +{branch.missionEffectExpected ?? Math.round((branch.missionEffectCores.min + branch.missionEffectCores.max) / 2)}</text>
                        </g>
                      ) : null}
                    </g>
                    {showLabel ? (
                      <text x={krNode.x + 15} y={krNode.y + 5} className={`goal-yggdrasil__node-label ${isSelected ? 'goal-yggdrasil__node-label--selected' : ''}`}>
                        {truncateLabel(branch.title)}
                      </text>
                    ) : null}
                  </g>
                )
              })}

              <g transform={`translate(${rootNode.x}, ${rootNode.y})`}>
                <circle className="goal-yggdrasil__root-core" r="18" />
                <circle className="goal-yggdrasil__root-aura" r="28" />
              </g>
            </g>
          </g>
        </svg>
      </div>
      {sceneBranches.length === 0 ? <p>Ветви появятся после настройки KR в Кузнице.</p> : null}
      <p className="goal-yggdrasil__caption">Выберите ветвь на сцене, чтобы синхронизировать фокус с Друидом.</p>
    </div>
  )
}
