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

const strengthLabel: Record<BranchStrength, string> = {
  weak: 'Слабая',
  normal: 'Стабильная',
  strong: 'Сильная',
}

const MOBILE_LABEL_QUERY = '(max-width: 760px)'

function cubicPoint(t: number, p0: number, p1: number, p2: number, p3: number): number {
  const u = 1 - t
  return u ** 3 * p0 + 3 * u ** 2 * t * p1 + 3 * u * t ** 2 * p2 + t ** 3 * p3
}

function cubicDerivative(t: number, p0: number, p1: number, p2: number, p3: number): number {
  const u = 1 - t
  return 3 * u ** 2 * (p1 - p0) + 6 * u * t * (p2 - p1) + 3 * t ** 2 * (p3 - p2)
}

function branchRibbonPath(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  startWidth: number,
  endWidth: number,
  sampleCount = 42,
): string {
  const midY = (sourceY + targetY) / 2
  const p0 = { x: sourceX, y: sourceY }
  const p1 = { x: sourceX, y: midY }
  const p2 = { x: targetX, y: midY }
  const p3 = { x: targetX, y: targetY }

  const left: Array<{ x: number; y: number }> = []
  const right: Array<{ x: number; y: number }> = []

  for (let index = 0; index <= sampleCount; index += 1) {
    const t = index / sampleCount
    const x = cubicPoint(t, p0.x, p1.x, p2.x, p3.x)
    const y = cubicPoint(t, p0.y, p1.y, p2.y, p3.y)
    const dx = cubicDerivative(t, p0.x, p1.x, p2.x, p3.x)
    const dy = cubicDerivative(t, p0.y, p1.y, p2.y, p3.y)
    const length = Math.hypot(dx, dy) || 1
    const nx = -dy / length
    const ny = dx / length
    const width = startWidth + (endWidth - startWidth) * t
    const offset = width / 2

    left.push({ x: x + nx * offset, y: y + ny * offset })
    right.push({ x: x - nx * offset, y: y - ny * offset })
  }

  const forward = left.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x},${point.y}`).join(' ')
  const backward = [...right].reverse().map((point) => `L${point.x},${point.y}`).join(' ')

  return `${forward} ${backward} Z`
}

function normalizeBranchId(branchId: string): string {
  return branchId.replace(/[^a-zA-Z0-9_-]/g, '-')
}

export function GoalYggdrasilTree({ objective, branches, selectedBranchId, onSelectBranch, resetSignal = 0 }: Props) {
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity)
  const [isMobile, setIsMobile] = useState(false)
  const sceneRef = useRef<SVGSVGElement | null>(null)
  const treeRef = useRef<SVGGElement | null>(null)
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null)

  const sceneBranches = branches.slice(0, 5)
  const fallbackObjective = objective || 'Уточните цель в Кузнице.'

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

    const sceneWidth = 860
    const sceneHeight = 540
    const marginX = 96
    const marginY = 90
    const tidyTree = tree<TreeHierarchyNode>()
      .size([sceneWidth - marginX * 2, sceneHeight - marginY * 2])
      .separation((a, b) => (a.parent === b.parent ? 1.2 : 1.5))

    const root = tidyTree(treeData)
    root.descendants().forEach((node) => {
      node.x += marginX
      node.y += marginY
    })

    return { root, sceneWidth, sceneHeight }
  }, [fallbackObjective, sceneBranches])

  const rootNode = layout.root
  const krNodes = layout.root.children ?? []

  const fitToView = useCallback(() => {
    if (!sceneRef.current || !zoomRef.current || !treeRef.current) return

    const svg = sceneRef.current
    const bbox = treeRef.current.getBBox()
    if (bbox.width <= 0 || bbox.height <= 0) return

    const padding = 32
    const viewportWidth = layout.sceneWidth
    const viewportHeight = layout.sceneHeight
    const targetHeight = viewportHeight * 0.78

    const kx = (viewportWidth - padding * 2) / bbox.width
    const ky = (targetHeight - padding * 2) / bbox.height
    const scale = Math.max(0.5, Math.min(2.3, Math.min(kx, ky)))

    const centerX = viewportWidth / 2
    const centerY = viewportHeight / 2
    const bboxCenterX = bbox.x + bbox.width / 2
    const bboxCenterY = bbox.y + bbox.height / 2

    const next = zoomIdentity.translate(centerX - bboxCenterX * scale, centerY - bboxCenterY * scale).scale(scale)
    const selection = select(svg)
    selection.call(zoomRef.current.transform, next)
  }, [layout.sceneHeight, layout.sceneWidth])

  useEffect(() => {
    if (!sceneRef.current) return

    const behavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.5, 2.8])
      .on('zoom', (event) => {
        setTransform(event.transform)
      })

    zoomRef.current = behavior
    const selection = select(sceneRef.current)
    selection.call(behavior)

    return () => {
      selection.on('.zoom', null)
    }
  }, [])

  useEffect(() => {
    const mediaQuery = window.matchMedia(MOBILE_LABEL_QUERY)
    const syncMobile = () => {
      setIsMobile(mediaQuery.matches)
    }

    syncMobile()
    mediaQuery.addEventListener('change', syncMobile)
    return () => {
      mediaQuery.removeEventListener('change', syncMobile)
    }
  }, [])

  useEffect(() => {
    fitToView()
  }, [fitToView, layout, selectedBranchId])

  useEffect(() => {
    if (resetSignal > 0) {
      fitToView()
    }
  }, [fitToView, resetSignal])

  return (
    <div className="goal-yggdrasil">
      <div className="goal-yggdrasil__head">
        <h2>Иггдрасиль</h2>
      </div>
      <p className="goal-yggdrasil__objective"><strong>Objective:</strong> {fallbackObjective}</p>
      <div className="goal-yggdrasil__scene" aria-label="Сцена Иггдрасиля">
        <div className="goal-yggdrasil__tools" aria-label="Управление сценой">
          <button type="button" className="filter-button" onClick={fitToView}>Сброс вида (R)</button>
          <button type="button" className="filter-button" onClick={fitToView}>Фокус дерева</button>
        </div>
        <svg ref={sceneRef} viewBox={`0 0 ${layout.sceneWidth} ${layout.sceneHeight}`} role="img" aria-label="Дерево Objective и KR ветвей">
          <defs>
            <radialGradient id="sceneVignette" cx="50%" cy="35%" r="70%">
              <stop offset="0%" stopColor="rgba(155,188,255,0.22)" />
              <stop offset="100%" stopColor="rgba(5,8,16,0.9)" />
            </radialGradient>
            <linearGradient id="trunkGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#5a3a2b" />
              <stop offset="42%" stopColor="#84573f" />
              <stop offset="100%" stopColor="#2f1f19" />
            </linearGradient>
            <filter id="branchShadow" x="-30%" y="-30%" width="160%" height="160%">
              <feDropShadow dx="0" dy="4" stdDeviation="5" floodColor="rgba(0,0,0,0.35)" />
              <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="rgba(168,205,255,0.22)" />
            </filter>
            <filter id="branchGlow" x="-40%" y="-40%" width="180%" height="180%">
              <feDropShadow dx="0" dy="0" stdDeviation="5" floodColor="rgba(150,205,255,0.55)" />
            </filter>
            <filter id="budGlow" x="-90%" y="-90%" width="280%" height="280%">
              <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="rgba(182,226,255,0.58)" />
            </filter>
            <radialGradient id="budWeak" cx="35%" cy="30%" r="70%">
              <stop offset="0%" stopColor="#ffd0d0" />
              <stop offset="100%" stopColor="#d86d6d" />
            </radialGradient>
            <radialGradient id="budNormal" cx="35%" cy="30%" r="70%">
              <stop offset="0%" stopColor="#d3e2ff" />
              <stop offset="100%" stopColor="#6f93df" />
            </radialGradient>
            <radialGradient id="budStrong" cx="35%" cy="30%" r="70%">
              <stop offset="0%" stopColor="#ceffec" />
              <stop offset="100%" stopColor="#56b993" />
            </radialGradient>
            {krNodes.map((krNode) => {
              if (krNode.data.kind !== 'kr' || !krNode.data.strength) return null
              const gradientId = `branch-grad-${normalizeBranchId(krNode.data.id)}`
              const strength = krNode.data.strength
              const colorMap: Record<BranchStrength, [string, string, string]> = {
                weak: ['rgba(246,111,111,0.26)', 'rgba(252,158,158,0.94)', 'rgba(186,73,73,0.26)'],
                normal: ['rgba(123,166,242,0.25)', 'rgba(160,194,255,0.95)', 'rgba(96,140,221,0.26)'],
                strong: ['rgba(72,186,150,0.24)', 'rgba(130,231,195,0.92)', 'rgba(44,153,122,0.24)'],
              }
              const [outerA, inner, outerB] = colorMap[strength]
              return (
                <linearGradient key={gradientId} id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor={outerA} />
                  <stop offset="50%" stopColor={inner} />
                  <stop offset="100%" stopColor={outerB} />
                </linearGradient>
              )
            })}
          </defs>

          <rect x="0" y="0" width={layout.sceneWidth} height={layout.sceneHeight} fill="url(#sceneVignette)" />

          <g ref={treeRef} transform={transform.toString()}>
            <path
              d={branchRibbonPath(rootNode.x, layout.sceneHeight - 10, rootNode.x + 5, rootNode.y + 30, 34, 20, 60)}
              className="goal-yggdrasil__trunk"
              filter="url(#branchShadow)"
            />

            {krNodes.map((krNode) => {
              if (krNode.data.kind !== 'kr' || !krNode.data.strength) return null
              const branch = krNode.data
              const strength = branch.strength as BranchStrength
              const isSelected = selectedBranchId === branch.id
              const isDimmed = selectedBranchId !== null && !isSelected
              const gradientId = `branch-grad-${normalizeBranchId(branch.id)}`
              const widthStart = strength === 'strong' ? 20 : strength === 'normal' ? 18 : 16
              const widthEnd = strength === 'strong' ? 13 : strength === 'normal' ? 12 : 10
              const showLabel = !isMobile || isSelected

              return (
                <g
                  key={branch.id}
                  className={`goal-yggdrasil__branch-group ${isSelected ? 'goal-yggdrasil__branch-group--selected' : ''} ${isDimmed ? 'goal-yggdrasil__branch-group--dimmed' : ''}`}
                >
                  <path
                    d={branchRibbonPath(rootNode.x + 2, rootNode.y + 20, krNode.x, krNode.y - 18, widthStart, widthEnd)}
                    className="goal-yggdrasil__branch"
                    fill={`url(#${gradientId})`}
                    filter="url(#branchShadow)"
                  />
                  {isSelected ? (
                    <path
                      d={`M${rootNode.x + 2},${rootNode.y + 20} C${rootNode.x + 2},${(rootNode.y + 20 + krNode.y - 18) / 2} ${krNode.x},${(rootNode.y + 20 + krNode.y - 18) / 2} ${krNode.x},${krNode.y - 18}`}
                      className="goal-yggdrasil__branch-highlight"
                      filter="url(#branchGlow)"
                    />
                  ) : null}

                  <g transform={`translate(${krNode.x},${krNode.y - 6})`}>
                    <path
                      d="M0,-14 C8,-14 14,-8 14,0 C14,9 7,16 0,20 C-7,16 -14,9 -14,0 C-14,-8 -8,-14 0,-14 Z"
                      className={`goal-yggdrasil__bud goal-yggdrasil__bud--${strength}`}
                      filter="url(#budGlow)"
                      onClick={() => onSelectBranch(branch.id)}
                    />
                    <circle className="goal-yggdrasil__bud-glint" cx="-4" cy="-6" r="3.4" />
                    <circle
                      className="goal-yggdrasil__node-hit"
                      cx="0"
                      cy="0"
                      r="22"
                      onClick={() => onSelectBranch(branch.id)}
                      aria-label={`Ветвь: ${branch.title}`}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          onSelectBranch(branch.id)
                        }
                      }}
                    />
                    {showLabel ? (
                      <text x="20" y="-2" className={`goal-yggdrasil__node-label ${isSelected ? 'goal-yggdrasil__node-label--selected' : ''}`}>
                        {branch.title}
                        <tspan x="20" dy="14" className="goal-yggdrasil__node-subtitle">
                          {strengthLabel[strength]} · {branch.direction === 'up' ? 'на рост' : 'на снижение'}
                        </tspan>
                      </text>
                    ) : null}
                  </g>
                </g>
              )
            })}
          </g>
        </svg>
      </div>
      {sceneBranches.length === 0 ? <p>Ветви появятся после настройки KR в Кузнице.</p> : null}
      <p className="goal-yggdrasil__caption">Выберите ветвь на сцене, чтобы синхронизировать фокус с Друидом.</p>
    </div>
  )
}
