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

function branchPath(sourceX: number, sourceY: number, targetX: number, targetY: number): string {
  const midY = (sourceY + targetY) / 2
  return `M${sourceX},${sourceY} C${sourceX},${midY} ${targetX},${midY} ${targetX},${targetY}`
}

export function GoalYggdrasilTree({ objective, branches, selectedBranchId, onSelectBranch, resetSignal = 0 }: Props) {
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity)
  const sceneRef = useRef<SVGSVGElement | null>(null)
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

    const sceneWidth = 760
    const sceneHeight = 440
    const marginX = 90
    const marginY = 70
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

  const resetView = useCallback(() => {
    if (!sceneRef.current || !zoomRef.current) return
    const selection = select(sceneRef.current)
    selection.call(zoomRef.current.transform, zoomIdentity)
  }, [])

  const focusTrunk = useCallback(() => {
    if (!sceneRef.current || !zoomRef.current) return
    const centerX = layout.sceneWidth / 2
    const centerY = layout.sceneHeight / 2
    const targetScale = Math.max(0.85, Math.min(transform.k, 1.4))
    const targetX = centerX - rootNode.x * targetScale
    const targetY = centerY - rootNode.y * targetScale
    const nextTransform = zoomIdentity.translate(targetX, targetY).scale(targetScale)
    const selection = select(sceneRef.current)
    selection.call(zoomRef.current.transform, nextTransform)
  }, [layout.sceneHeight, layout.sceneWidth, rootNode.x, rootNode.y, transform.k])

  useEffect(() => {
    if (!sceneRef.current) return

    const behavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.6, 2.5])
      .on('zoom', (event) => {
        setTransform(event.transform)
      })

    zoomRef.current = behavior
    const selection = select(sceneRef.current)
    selection.call(behavior)
    selection.call(behavior.transform, zoomIdentity)

    return () => {
      selection.on('.zoom', null)
    }
  }, [])

  useEffect(() => {
    if (resetSignal > 0) {
      resetView()
    }
  }, [resetSignal, resetView])

  return (
    <div className="goal-yggdrasil">
      <div className="goal-yggdrasil__head">
        <h2>Иггдрасиль</h2>
        <div className="goal-yggdrasil__tools">
          <button type="button" className="filter-button" onClick={resetView}>Сброс вида (R)</button>
          <button type="button" className="filter-button" onClick={focusTrunk}>Фокус на стволе</button>
        </div>
      </div>
      <p className="goal-yggdrasil__objective"><strong>Objective:</strong> {fallbackObjective}</p>
      <div className="goal-yggdrasil__scene" aria-label="Сцена Иггдрасиля">
        <svg ref={sceneRef} viewBox={`0 0 ${layout.sceneWidth} ${layout.sceneHeight}`} role="img" aria-label="Дерево Objective и KR ветвей">
          <defs>
            <linearGradient id="trunkGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#5a3f2f" />
              <stop offset="100%" stopColor="#32231c" />
            </linearGradient>
          </defs>
          <g transform={transform.toString()}>
            <path d={`M${rootNode.x},${layout.sceneHeight - 18} C${rootNode.x - 10},${layout.sceneHeight - 74} ${rootNode.x + 8},${rootNode.y + 60} ${rootNode.x},${rootNode.y + 26}`} className="goal-yggdrasil__trunk" />

            {krNodes.map((krNode) => {
              if (krNode.data.kind !== 'kr' || !krNode.data.strength) return null
              const branch = krNode.data
              const strength = branch.strength as BranchStrength
              const isSelected = selectedBranchId === branch.id
              const isDimmed = selectedBranchId !== null && !isSelected
              return (
                <g key={branch.id} className={`goal-yggdrasil__branch-group ${isSelected ? 'goal-yggdrasil__branch-group--selected' : ''} ${isDimmed ? 'goal-yggdrasil__branch-group--dimmed' : ''}`}>
                  <path
                    d={branchPath(rootNode.x, rootNode.y + 18, krNode.x, krNode.y - 18)}
                    className={`goal-yggdrasil__branch goal-yggdrasil__branch--${strength} ${isSelected ? 'goal-yggdrasil__branch--selected' : ''}`}
                  />
                  <foreignObject x={krNode.x - 94} y={krNode.y - 28} width="188" height="68">
                    <button
                      type="button"
                      className={`goal-yggdrasil__node-button goal-yggdrasil__node-button--${strength} ${isSelected ? 'goal-yggdrasil__node-button--selected' : ''}`}
                      onClick={() => onSelectBranch(branch.id)}
                      aria-label={`Ветвь: ${branch.title}`}
                    >
                      <span className="goal-yggdrasil__node-title">{branch.title}</span>
                      <span className="goal-yggdrasil__node-status">{strengthLabel[strength]} · {branch.direction === 'up' ? 'на рост' : 'на снижение'}</span>
                    </button>
                  </foreignObject>
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
