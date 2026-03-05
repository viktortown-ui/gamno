import { hierarchy, pack, type HierarchyCircularNode } from 'd3-hierarchy'
import { select } from 'd3-selection'
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const DEFAULT_SCENE_WIDTH = 900
const DEFAULT_SCENE_HEIGHT = 560
const FIT_PADDING = 36
const MAX_UNIVERSE_LEVERS = 3

interface StageLever {
  id: string
  title: string
  influence: number
  priorityBand: 'low' | 'medium' | 'high'
  isWeak: boolean
  hasActiveMission: boolean
}

export interface UniverseStageGoal {
  id: string
  title: string
  objective: string
  sizeScore: number
  temperature: 'hot' | 'neutral' | 'cold'
  levers: StageLever[]
}

interface GoalCellsStageProps {
  goals: UniverseStageGoal[]
  selectedGoalId: string | null
  selectedBranchId: string | null
  onSelectGoal: (goalId: string) => void
  onSelectBranch: (branchId: string) => void
  onClearBranch: () => void
  resetSignal?: number
}

interface LayoutLever extends StageLever {
  x: number
  y: number
  r: number
  isSelected: boolean
}

interface LayoutGoal extends UniverseStageGoal {
  x: number
  y: number
  r: number
  leversLayout: LayoutLever[]
  visibleLeverCount: number
  isSelected: boolean
  temperature: 'hot' | 'neutral' | 'cold'
}

interface PackDatum {
  id: string
  value: number
  lever?: StageLever
  goal?: UniverseStageGoal
  children?: PackDatum[]
}

function computeGoalBounds(nodes: Array<{ x: number; y: number; r: number }>) {
  if (nodes.length === 0) return null
  const minX = Math.min(...nodes.map((node) => node.x - node.r))
  const minY = Math.min(...nodes.map((node) => node.y - node.r))
  const maxX = Math.max(...nodes.map((node) => node.x + node.r))
  const maxY = Math.max(...nodes.map((node) => node.y + node.r))
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }
}

function packLevers(goal: UniverseStageGoal, goalX: number, goalY: number, goalR: number, selectedBranchId: string | null): LayoutLever[] {
  const innerPadding = Math.max(4, Math.min(12, goalR * 0.08))
  const shell = Math.max(20, goalR - innerPadding)
  const leverRoot = hierarchy<PackDatum>({
    id: `${goal.id}-levers`,
    value: 0,
    children: goal.levers
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((lever) => ({ id: lever.id, value: Math.max(1, lever.influence), lever })),
  }).sum((node) => node.value)

  const packed = pack<PackDatum>().size([shell * 2, shell * 2]).padding(Math.max(3, shell * 0.05))(leverRoot)
  const maxLevers = Math.min(MAX_UNIVERSE_LEVERS, goal.levers.length)
  return (packed.children ?? [])
    .slice()
    .sort((a, b) => b.r - a.r)
    .slice(0, maxLevers)
    .map((leaf) => {
      const lever = leaf.data.lever
      if (!lever) {
        throw new Error('Lever payload is missing in goal pack')
      }
      return {
        ...lever,
        x: goalX - shell + leaf.x,
        y: goalY - shell + leaf.y,
        r: Math.max(8, leaf.r),
        isSelected: lever.id === selectedBranchId,
      }
    })
}

function computeUniverseLayout(width: number, height: number, goals: UniverseStageGoal[], selectedGoalId: string | null, selectedBranchId: string | null): LayoutGoal[] {
  if (goals.length === 0) return []
  const root = hierarchy<PackDatum>({
    id: 'universe-root',
    value: 0,
    children: goals
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((goal) => ({
      id: goal.id,
      value: Math.max(1, goal.sizeScore),
      goal,
      })),
  }).sum((node) => node.value)

  const packed = pack<PackDatum>().size([width, height]).padding(18)(root)
  return (packed.children ?? []).map((leaf: HierarchyCircularNode<PackDatum>) => {
    const goal = leaf.data.goal
    if (!goal) {
      throw new Error('Goal payload is missing in universe pack')
    }
    return {
      ...goal,
      x: leaf.x,
      y: leaf.y,
      r: Math.max(36, leaf.r),
      leversLayout: packLevers(goal, leaf.x, leaf.y, Math.max(36, leaf.r), selectedBranchId),
      visibleLeverCount: Math.min(MAX_UNIVERSE_LEVERS, goal.levers.length),
      isSelected: goal.id === selectedGoalId,
      temperature: goal.temperature,
    }
  })
}

export function GoalCellsStage({ goals, selectedGoalId, selectedBranchId, onSelectGoal, onSelectBranch, onClearBranch, resetSignal = 0 }: GoalCellsStageProps) {
  const [viewSize, setViewSize] = useState({ width: DEFAULT_SCENE_WIDTH, height: DEFAULT_SCENE_HEIGHT })
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity)
  const [isMobile, setIsMobile] = useState(false)
  const [fitRequest, setFitRequest] = useState<{ mode: 'all' | 'selected'; key: number } | null>(null)
  const sceneRef = useRef<SVGSVGElement | null>(null)
  const sceneWrapRef = useRef<HTMLDivElement | null>(null)
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null)
  const fitKeyRef = useRef(0)
  const mountedRef = useRef(false)

  useEffect(() => {
    if (!sceneWrapRef.current || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      setViewSize({
        width: Math.max(320, Math.round(entry.contentRect.width)),
        height: Math.max(320, Math.round(entry.contentRect.height)),
      })
    })
    observer.observe(sceneWrapRef.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(max-width: 860px), (pointer: coarse)')
    const sync = () => setIsMobile(media.matches)
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])

  const layoutGoals = useMemo(
    () => computeUniverseLayout(viewSize.width, viewSize.height, goals, selectedGoalId, selectedBranchId),
    [goals, selectedBranchId, selectedGoalId, viewSize.height, viewSize.width],
  )

  const goalById = useMemo(() => new Map(layoutGoals.map((goal) => [goal.id, goal])), [layoutGoals])
  const dataSignature = useMemo(() => goals.map((goal) => goal.id).sort().join('|'), [goals])

  const applyTransform = useCallback((target: ZoomTransform, durationMs = 240) => {
    if (!sceneRef.current || !zoomRef.current) return
    const selection = select(sceneRef.current)
    void durationMs
    selection.call(zoomRef.current.transform, target)
  }, [])

  const computeFitTransform = useCallback((nodes: Array<{ x: number; y: number; r: number }>): ZoomTransform => {
    const bounds = computeGoalBounds(nodes)
    if (!bounds) return zoomIdentity
    const availableWidth = Math.max(10, viewSize.width - FIT_PADDING * 2)
    const availableHeight = Math.max(10, viewSize.height - FIT_PADDING * 2)
    const baseScale = Math.min(availableWidth / Math.max(1, bounds.width), availableHeight / Math.max(1, bounds.height))
    const scale = Math.max(0.6, Math.min(2.2, baseScale * 0.9))
    const centerX = (bounds.minX + bounds.maxX) / 2
    const centerY = (bounds.minY + bounds.maxY) / 2
    return zoomIdentity.translate(viewSize.width / 2 - centerX * scale, viewSize.height / 2 - centerY * scale).scale(scale)
  }, [viewSize.height, viewSize.width])

  const runFitToView = useCallback((durationMs = 260) => {
    applyTransform(computeFitTransform(layoutGoals), durationMs)
  }, [applyTransform, computeFitTransform, layoutGoals])

  const runFocusSelected = useCallback((goalId?: string, durationMs = 260) => {
    const targetId = goalId ?? selectedGoalId
    if (!targetId) return
    const targetGoal = goalById.get(targetId)
    if (!targetGoal) return
    applyTransform(computeFitTransform([{ x: targetGoal.x, y: targetGoal.y, r: Math.max(targetGoal.r + 28, targetGoal.r * 1.2) }]), durationMs)
  }, [applyTransform, computeFitTransform, goalById, selectedGoalId])

  const queueFit = useCallback((mode: 'all' | 'selected') => {
    fitKeyRef.current += 1
    setFitRequest({ mode, key: fitKeyRef.current })
  }, [])

  useEffect(() => {
    if (!sceneRef.current) return
    const behavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.6, 2.4])
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
    if (!mountedRef.current) {
      mountedRef.current = true
      queueFit('all')
      return
    }
    queueFit('all')
  }, [dataSignature, queueFit])

  useEffect(() => {
    if (resetSignal > 0) queueFit('all')
  }, [queueFit, resetSignal])

  useEffect(() => {
    if (!fitRequest) return
    requestAnimationFrame(() => {
      if (fitRequest.mode === 'selected') {
        runFocusSelected(undefined, 260)
      } else {
        runFitToView(260)
      }
    })
  }, [fitRequest, runFitToView, runFocusSelected])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        queueFit('all')
      } else if (event.key.toLowerCase() === 'r') {
        event.preventDefault()
        queueFit('all')
      } else if (event.key.toLowerCase() === 'f' && selectedGoalId) {
        event.preventDefault()
        queueFit('selected')
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [queueFit, selectedGoalId])

  return (
    <div className="goal-cells-stage">
      <div className="goal-cells-stage__head">
        <h2>Goal Cells Stage</h2>
      </div>
      <p className="goal-cells-stage__objective"><strong>Universe:</strong> все цели текущего фильтра Forest на одной сцене.</p>
      <div className="goal-cells-stage__scene" ref={sceneWrapRef} aria-label="Сцена всех целей и рычагов">
        <div className="goal-cells-stage__floating-controls" role="toolbar" aria-label="Управление сценой">
          <button type="button" className="filter-button" onClick={() => queueFit('all')}>{isMobile ? '↺' : 'Сброс вида (R)'}</button>
          <button type="button" className="filter-button" onClick={() => queueFit('selected')} disabled={!selectedGoalId}>{isMobile ? '◎' : 'Фокус выбранной (F)'}</button>
        </div>
        <svg ref={sceneRef} viewBox={`0 0 ${viewSize.width} ${viewSize.height}`} role="img" aria-label="Вселенная целей">
          <rect className="goal-cells-stage__catcher" x={0} y={0} width={viewSize.width} height={viewSize.height} fill="transparent" onClick={onClearBranch} />
          <g transform={transform.toString()}>
            {layoutGoals.map((goal) => (
              <g
                key={goal.id}
                className={goal.isSelected ? 'goal-cells-stage__goal goal-cells-stage__goal--selected' : 'goal-cells-stage__goal'}
                role="button"
                tabIndex={0}
                onClick={() => onSelectGoal(goal.id)}
                onDoubleClick={() => runFocusSelected(goal.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onSelectGoal(goal.id)
                  }
                }}
                aria-label={`Цель: ${goal.title}`}
              >
                <circle className={`goal-cells-stage__goal-shell goal-cells-stage__goal-shell--${goal.temperature}`} cx={goal.x} cy={goal.y} r={goal.r} />
                <text className="goal-cells-stage__goal-title" x={goal.x} y={goal.y - goal.r + 18}>{goal.title.slice(0, 26)}</text>

                {goal.leversLayout.map((lever) => (
                  <g
                    key={lever.id}
                    className={lever.isSelected ? 'goal-cells-stage__kr goal-cells-stage__kr--selected' : 'goal-cells-stage__kr'}
                    role="button"
                    tabIndex={0}
                    onClick={(event) => {
                      event.stopPropagation()
                      onSelectGoal(goal.id)
                      onSelectBranch(lever.id)
                    }}
                  >
                    <circle className={`goal-cells-stage__kr-halo goal-cells-stage__kr-halo--${lever.priorityBand}`} cx={lever.x} cy={lever.y} r={Math.max(lever.r + 6, 11)} />
                    <circle className="goal-cells-stage__kr-core" cx={lever.x} cy={lever.y} r={lever.r} />
                    {lever.isWeak ? (
                      <g className="goal-cells-stage__weak-crack">
                        <path d={`M ${lever.x - lever.r * 0.35} ${lever.y - lever.r * 0.3} L ${lever.x - lever.r * 0.08} ${lever.y - lever.r * 0.06} L ${lever.x + lever.r * 0.2} ${lever.y + lever.r * 0.06} L ${lever.x + lever.r * 0.06} ${lever.y + lever.r * 0.24}`} />
                      </g>
                    ) : null}
                    {lever.hasActiveMission ? <circle className="goal-cells-stage__mission-dot" cx={lever.x + lever.r * 0.55} cy={lever.y - lever.r * 0.55} r={Math.max(3, lever.r * 0.18)} /> : null}
                    {!isMobile || lever.isSelected ? <text x={lever.x} y={lever.y + 4}>{lever.title.slice(0, 10)}</text> : null}
                  </g>
                ))}

                {goal.levers.length > goal.visibleLeverCount ? (
                  <text className="goal-cells-stage__more" x={goal.x - 16} y={goal.y + goal.r - 10}>{`+${goal.levers.length - goal.visibleLeverCount}`}</text>
                ) : null}
              </g>
            ))}
          </g>
        </svg>
      </div>
    </div>
  )
}
