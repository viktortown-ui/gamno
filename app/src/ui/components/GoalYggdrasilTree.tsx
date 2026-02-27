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
  children?: TreeHierarchyNode[]
}

const DEFAULT_SCENE_WIDTH = 900
const DEFAULT_SCENE_HEIGHT = 560
const FIT_PADDING = 32

function branchPath(sourceX: number, sourceY: number, targetX: number, targetY: number): string {
  const dx = targetX - sourceX
  const dy = targetY - sourceY
  const bend = Math.max(30, Math.abs(dy) * 0.42)
  return `M${sourceX},${sourceY} C${sourceX + dx * 0.22},${sourceY - bend} ${targetX - dx * 0.2},${targetY + bend * 0.5} ${targetX},${targetY}`
}

function truncateLabel(value: string, max = 22): string {
  if (value.length <= max) return value
  return `${value.slice(0, max - 1).trimEnd()}…`
}

export function GoalYggdrasilTree({ objective, branches, selectedBranchId, onSelectBranch, resetSignal = 0 }: Props) {
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity)
  const [viewSize, setViewSize] = useState({ width: DEFAULT_SCENE_WIDTH, height: DEFAULT_SCENE_HEIGHT })
  const [isMobile, setIsMobile] = useState(false)
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
      })),
    })

    const horizontalPadding = Math.max(42, Math.min(108, viewSize.width * 0.1))
    const verticalPadding = Math.max(40, Math.min(90, viewSize.height * 0.12))
    const tidyTree = tree<TreeHierarchyNode>()
      .size([Math.max(220, viewSize.width - horizontalPadding * 2), Math.max(180, viewSize.height - verticalPadding * 2)])
      .separation((a, b) => (a.parent === b.parent ? 1.45 : 1.75))

    const root = tidyTree(treeData)

    root.descendants().forEach((node) => {
      node.x += horizontalPadding
      node.y = viewSize.height - verticalPadding - node.y
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
    const scale = Math.max(0.7, Math.min(1.9, Math.min(availableWidth / bbox.width, availableHeight / bbox.height) * 0.82))
    const translateX = (viewportBounds.width - bbox.width * scale) / 2 - bbox.x * scale
    const translateY = (viewportBounds.height - bbox.height * scale) / 2 - bbox.y * scale

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
      .scaleExtent([0.45, 2.8])
      .translateExtent([
        [-viewSize.width * 0.35, -viewSize.height * 0.35],
        [viewSize.width * 1.35, viewSize.height * 1.35],
      ])
      .on('zoom', (event) => {
        setTransform(event.transform)
      })

    zoomRef.current = behavior
    const selection = select(sceneRef.current)
    selection.call(behavior)

    return () => {
      selection.on('.zoom', null)
    }
  }, [viewSize.height, viewSize.width])

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
          <button type="button" className="filter-button" onClick={resetView}>Сброс вида (R)</button>
          <button type="button" className="filter-button" onClick={focusTrunk}>Фокус на стволе</button>
        </div>
        <svg ref={sceneRef} viewBox={`0 0 ${viewSize.width} ${viewSize.height}`} role="img" aria-label="Дерево Objective и KR ветвей">
          <defs>
            <linearGradient id="trunkGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#7f5338" />
              <stop offset="100%" stopColor="#2e1f18" />
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
          </defs>
          <g transform={transform.toString()}>
            <g className="tree-viewport" ref={treeViewportRef}>
              <path
                d={`M${rootNode.x},${viewSize.height - 12} C${rootNode.x - 13},${viewSize.height - 120} ${rootNode.x + 13},${rootNode.y + 84} ${rootNode.x},${rootNode.y + 18}`}
                className="goal-yggdrasil__trunk"
              />

              {krNodes.map((krNode) => {
                if (krNode.data.kind !== 'kr' || !krNode.data.strength) return null
                const branch = krNode.data
                const isSelected = selectedBranchId === branch.id
                const isDimmed = selectedBranchId !== null && !isSelected
                const showLabel = !isMobile || isSelected

                return (
                  <g
                    key={branch.id}
                    className={`goal-yggdrasil__branch-group ${isSelected ? 'goal-yggdrasil__branch-group--selected' : ''} ${isDimmed ? 'goal-yggdrasil__branch-group--dimmed' : ''}`}
                  >
                    <path
                      d={branchPath(rootNode.x, rootNode.y + 12, krNode.x, krNode.y)}
                      className={`goal-yggdrasil__branch goal-yggdrasil__branch--${branch.strength} ${isSelected ? 'goal-yggdrasil__branch--selected' : ''}`}
                    />
                    <g transform={`translate(${krNode.x}, ${krNode.y})`}>
                      <circle className="goal-yggdrasil__node-hit" r="22" onClick={() => onSelectBranch(branch.id)} />
                      <circle className={`goal-yggdrasil__node-core goal-yggdrasil__node-core--${branch.strength} ${isSelected ? 'goal-yggdrasil__node-core--selected' : ''}`} r="10" filter="url(#nodeGlow)" />
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
