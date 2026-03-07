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
  isMissionWeakSpot?: boolean
}

export interface UniverseStageGoal {
  id: string
  title: string
  objective: string
  sizeScore: number
  temperature: 'hot' | 'neutral' | 'cold'
  levers: StageLever[]
  missionHud?: { title: string; costLabel: string }
}

export interface UniverseStageLink {
  id: string
  sourceGoalId: string
  targetGoalId: string
  type: 'supports' | 'depends_on' | 'conflicts'
}

interface GoalCellsStageProps {
  goals: UniverseStageGoal[]
  links: UniverseStageLink[]
  showLinks: boolean
  selectedGoalId: string | null
  selectedBranchId: string | null
  onSelectGoal: (goalId: string) => void
  onSelectBranch: (branchId: string) => void
  onClearBranch: () => void
  resetSignal?: number
  tooFewGoalsHint?: string | null
  overlayLabel?: string
  resetLabel?: string
  focusLabel?: string
  onMissionHudClick?: () => void
}

interface GoalLinkPath {
  id: string
  sourceGoalId: string
  targetGoalId: string
  type: UniverseStageLink['type']
  d: string
  midX: number
  midY: number
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

function boundaryPoint(from: { x: number; y: number; r: number }, to: { x: number; y: number; r: number }, offset: number) {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const dist = Math.hypot(dx, dy) || 1
  const ux = dx / dist
  const uy = dy / dist
  const distanceFromCenter = Math.max(0, from.r + offset)
  return {
    x: from.x + ux * distanceFromCenter,
    y: from.y + uy * distanceFromCenter,
  }
}

function buildLinkPath(source: { x: number; y: number; r: number }, target: { x: number; y: number; r: number }): { d: string; midX: number; midY: number } {
  const linkPadding = 3
  const sourceAnchor = boundaryPoint(source, target, linkPadding)
  const targetAnchor = boundaryPoint(target, source, linkPadding)
  const dx = targetAnchor.x - sourceAnchor.x
  const dy = targetAnchor.y - sourceAnchor.y
  const distance = Math.hypot(dx, dy)
  const normalX = distance > 0 ? -dy / distance : 0
  const normalY = distance > 0 ? dx / distance : 0
  const bend = Math.min(58, Math.max(16, distance * 0.24))
  const c1 = {
    x: sourceAnchor.x + dx * 0.35 + normalX * bend,
    y: sourceAnchor.y + dy * 0.35 + normalY * bend,
  }
  const c2 = {
    x: sourceAnchor.x + dx * 0.65 + normalX * bend,
    y: sourceAnchor.y + dy * 0.65 + normalY * bend,
  }
  const midX = sourceAnchor.x + dx * 0.5 + normalX * bend * 0.8
  const midY = sourceAnchor.y + dy * 0.5 + normalY * bend * 0.8
  return {
    d: `M ${sourceAnchor.x} ${sourceAnchor.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${targetAnchor.x} ${targetAnchor.y}`,
    midX,
    midY,
  }
}

export function GoalCellsStage({ goals, links, showLinks, selectedGoalId, selectedBranchId, onSelectGoal, onSelectBranch, onClearBranch, resetSignal = 0, tooFewGoalsHint = null, overlayLabel = 'Сцена', resetLabel = 'Сброс вида (R)', focusLabel = 'Фокус (F)', onMissionHudClick }: GoalCellsStageProps) {
  const [viewSize, setViewSize] = useState({ width: DEFAULT_SCENE_WIDTH, height: DEFAULT_SCENE_HEIGHT })
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity)
  const [isMobile, setIsMobile] = useState(false)
  const [fitRequest, setFitRequest] = useState<{ kind: 'ALL' | 'FOCUS'; key: string; requestedAt: number; reason: string } | null>(null)
  const [interactionRevision, setInteractionRevision] = useState(0)
  const [fitApplyCount, setFitApplyCount] = useState(0)
  const [lastFitReason, setLastFitReason] = useState('none')
  const sceneRef = useRef<SVGSVGElement | null>(null)
  const sceneWrapRef = useRef<HTMLDivElement | null>(null)
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null)
  const fitKeyRef = useRef(0)
  const lastViewportSizeRef = useRef(viewSize)
  const lastAppliedFitKeyRef = useRef<string | null>(null)
  const isInteractingRef = useRef(false)
  const interactionEndTimerRef = useRef<number | null>(null)
  const mountedRef = useRef(false)
  const debugEnabled = typeof window !== 'undefined' && window.localStorage.getItem('cc_debug') === '1'

  const queueFit = useCallback((kind: 'ALL' | 'FOCUS', reason: string, force = false) => {
    const key = force ? `${kind}:${reason}:manual:${Date.now()}:${fitKeyRef.current + 1}` : `${kind}:${reason}`
    fitKeyRef.current += 1
    setFitRequest((current) => {
      if (!force && current?.key === key) return current
      return { kind, key, requestedAt: Date.now(), reason }
    })
  }, [])

  useEffect(() => {
    if (!sceneWrapRef.current || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const next = {
        width: Math.max(320, Math.round(entry.contentRect.width)),
        height: Math.max(320, Math.round(entry.contentRect.height)),
      }
      const prev = lastViewportSizeRef.current
      if (Math.abs(next.width - prev.width) < 2 && Math.abs(next.height - prev.height) < 2) return
      lastViewportSizeRef.current = next
      setViewSize(next)
      queueFit('ALL', `resize:${next.width}x${next.height}`)
    })
    observer.observe(sceneWrapRef.current)
    return () => observer.disconnect()
  }, [queueFit])

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
  const goalLinkPaths = useMemo<GoalLinkPath[]>(() => {
    if (!showLinks || !selectedGoalId) return []
    return links
      .filter((link) => link.sourceGoalId === selectedGoalId)
      .map((link) => {
        const source = goalById.get(link.sourceGoalId)
        const target = goalById.get(link.targetGoalId)
        if (!source || !target) return null
        const path = buildLinkPath(source, target)
        return {
          id: link.id,
          sourceGoalId: link.sourceGoalId,
          targetGoalId: link.targetGoalId,
          type: link.type,
          d: path.d,
          midX: path.midX,
          midY: path.midY,
        }
      })
      .filter((link): link is GoalLinkPath => Boolean(link))
  }, [goalById, links, selectedGoalId, showLinks])
  const dataSignature = useMemo(() => goals.map((goal) => goal.id).sort().join('|'), [goals])

  const applyTransform = useCallback((target: ZoomTransform, durationMs = 240) => {
    if (!sceneRef.current || !zoomRef.current) return false
    const selection = select(sceneRef.current)
    void durationMs
    selection.call(zoomRef.current.transform, target)
    return true
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
    if (layoutGoals.length === 0) return false
    return applyTransform(computeFitTransform(layoutGoals), durationMs)
  }, [applyTransform, computeFitTransform, layoutGoals])

  const runFocusSelected = useCallback((goalId?: string, durationMs = 260) => {
    const targetId = goalId ?? selectedGoalId
    if (!targetId) return false
    const targetGoal = goalById.get(targetId)
    if (!targetGoal) return false
    return applyTransform(computeFitTransform([{ x: targetGoal.x, y: targetGoal.y, r: Math.max(targetGoal.r + 28, targetGoal.r * 1.2) }]), durationMs)
  }, [applyTransform, computeFitTransform, goalById, selectedGoalId])

  useEffect(() => {
    if (!sceneRef.current) return
    const behavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.6, 2.4])
      .translateExtent([
        [-viewSize.width * 0.35, -viewSize.height * 0.35],
        [viewSize.width * 1.35, viewSize.height * 1.35],
      ])
      .on('start', () => {
        isInteractingRef.current = true
        if (interactionEndTimerRef.current !== null) {
          window.clearTimeout(interactionEndTimerRef.current)
          interactionEndTimerRef.current = null
        }
      })
      .on('zoom', (event) => {
        setTransform(event.transform)
      })
      .on('end', () => {
        if (interactionEndTimerRef.current !== null) window.clearTimeout(interactionEndTimerRef.current)
        interactionEndTimerRef.current = window.setTimeout(() => {
          isInteractingRef.current = false
          setInteractionRevision((current) => current + 1)
        }, 200)
      })

    zoomRef.current = behavior
    const selection = select(sceneRef.current)
    selection.call(behavior)
    return () => {
      if (interactionEndTimerRef.current !== null) {
        window.clearTimeout(interactionEndTimerRef.current)
        interactionEndTimerRef.current = null
      }
      selection.on('.zoom', null)
    }
  }, [viewSize.height, viewSize.width])

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true
      requestAnimationFrame(() => {
        queueFit('ALL', `mount:${dataSignature}`)
      })
      return
    }
    requestAnimationFrame(() => {
      queueFit('ALL', `dataset:${dataSignature}`)
    })
  }, [dataSignature, queueFit])

  useEffect(() => {
    if (resetSignal <= 0) return
    requestAnimationFrame(() => {
      queueFit('ALL', `reset:${resetSignal}`, true)
    })
  }, [queueFit, resetSignal])

  useEffect(() => {
    if (!fitRequest) return
    if (isInteractingRef.current) return
    if (fitRequest.key === lastAppliedFitKeyRef.current) {
      requestAnimationFrame(() => {
        setFitRequest(null)
      })
      return
    }
    requestAnimationFrame(() => {
      let applied = false
      if (fitRequest.kind === 'FOCUS') {
        applied = runFocusSelected(undefined, 260)
      } else {
        applied = runFitToView(260)
      }
      if (!applied) return
      lastAppliedFitKeyRef.current = fitRequest.key
      setFitApplyCount((current) => current + 1)
      setLastFitReason(fitRequest.reason)
      if (debugEnabled) {
        console.debug('[GoalCellsStage] fit applied', {
          key: fitRequest.key,
          reason: fitRequest.reason,
          count: fitApplyCount + 1,
          transform: {
            k: transform.k,
            x: transform.x,
            y: transform.y,
          },
        })
      }
      setFitRequest(null)
    })
  }, [debugEnabled, fitApplyCount, fitRequest, interactionRevision, runFitToView, runFocusSelected, transform.k, transform.x, transform.y])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        queueFit('ALL', 'key:escape', true)
      } else if (event.key.toLowerCase() === 'r') {
        event.preventDefault()
        queueFit('ALL', 'key:r', true)
      } else if (event.key.toLowerCase() === 'f' && selectedGoalId) {
        event.preventDefault()
        queueFit('FOCUS', `key:f:${selectedGoalId}`, true)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [queueFit, selectedGoalId])

  return (
    <div className="goal-cells-stage">
      <div className="goal-cells-stage__scene" ref={sceneWrapRef} aria-label="Сцена всех целей и рычагов">
        <div className="goal-cells-stage__overlay-label">{overlayLabel}</div>
        {tooFewGoalsHint ? <p className="goal-cells-stage__inline-hint">{tooFewGoalsHint}</p> : null}
        <div className="goal-cells-stage__floating-controls" role="toolbar" aria-label="Управление сценой">
          <button type="button" className="filter-button goal-cells-stage__hud-chip" onClick={() => queueFit('ALL', 'button:reset', true)}>{isMobile ? '↺' : resetLabel}</button>
          <button type="button" className="filter-button goal-cells-stage__hud-chip" onClick={() => queueFit('FOCUS', `button:focus:${selectedGoalId ?? 'none'}`, true)} disabled={!selectedGoalId}>{isMobile ? '◎' : focusLabel}</button>
          {debugEnabled ? <span className="goal-cells-stage__hud-chip" aria-live="polite">fit:{fitApplyCount} · {lastFitReason} · k:{transform.k.toFixed(2)} x:{transform.x.toFixed(0)} y:{transform.y.toFixed(0)}</span> : null}
        </div>
        <svg ref={sceneRef} viewBox={`0 0 ${viewSize.width} ${viewSize.height}`} role="img" aria-label="Сцена целей">
          <rect className="goal-cells-stage__catcher" x={0} y={0} width={viewSize.width} height={viewSize.height} fill="transparent" onClick={onClearBranch} />
          <g transform={transform.toString()}>
            <g className="goal-cells-stage__links-layer" aria-hidden="true">
              {goalLinkPaths.map((link) => (
                <g key={link.id}>
                  <path className={`goal-cells-stage__link goal-cells-stage__link--${link.type}`} d={link.d} />
                  {link.type === 'conflicts' ? (
                    <path
                      className="goal-cells-stage__link-zig"
                      d={`M ${link.midX - 7} ${link.midY + 2} L ${link.midX - 2} ${link.midY - 3} L ${link.midX + 3} ${link.midY + 3} L ${link.midX + 8} ${link.midY - 2}`}
                    />
                  ) : null}
                </g>
              ))}
            </g>
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
                    <circle className={`goal-cells-stage__kr-halo goal-cells-stage__kr-halo--${lever.priorityBand}${lever.isMissionWeakSpot ? ' goal-cells-stage__kr-halo--mission-weak' : ''}`} cx={lever.x} cy={lever.y} r={Math.max(lever.r + 6, 11)} />
                    <circle className={`goal-cells-stage__kr-core${lever.isMissionWeakSpot ? ' goal-cells-stage__kr-core--mission-weak' : ''}`} cx={lever.x} cy={lever.y} r={lever.r} />
                    {lever.isWeak ? (
                      <g className="goal-cells-stage__weak-crack">
                        <path d={`M ${lever.x - lever.r * 0.35} ${lever.y - lever.r * 0.3} L ${lever.x - lever.r * 0.08} ${lever.y - lever.r * 0.06} L ${lever.x + lever.r * 0.2} ${lever.y + lever.r * 0.06} L ${lever.x + lever.r * 0.06} ${lever.y + lever.r * 0.24}`} />
                      </g>
                    ) : null}
                    {lever.hasActiveMission ? <circle className="goal-cells-stage__mission-dot" cx={lever.x + lever.r * 0.55} cy={lever.y - lever.r * 0.55} r={Math.max(3, lever.r * 0.18)} /> : null}
                  </g>
                ))}

                {goal.isSelected ? <text className="goal-cells-stage__goal-title" x={goal.x} y={goal.y - goal.r + 18}>{goal.title.slice(0, 26)}</text> : null}
                {!isMobile && goal.isSelected ? goal.leversLayout.filter((lever) => lever.isSelected || selectedBranchId === lever.id).map((lever) => <text key={`label-${lever.id}`} className="goal-cells-stage__lever-title" x={lever.x} y={lever.y + 4}>{lever.title.slice(0, 10)}</text>) : null}
                {isMobile ? goal.leversLayout.filter((lever) => lever.isSelected).map((lever) => <text key={`label-${lever.id}`} className="goal-cells-stage__lever-title" x={lever.x} y={lever.y + 4}>{lever.title.slice(0, 10)}</text>) : null}
                {goal.isSelected && goal.missionHud ? (
                  <g className="goal-cells-stage__mission-hud" role="button" tabIndex={0} onClick={(event) => { event.stopPropagation(); onMissionHudClick?.() }}>
                    <rect x={goal.x + goal.r * 0.2} y={goal.y - goal.r * 0.95} rx={10} ry={10} width={190} height={50} />
                    <text x={goal.x + goal.r * 0.2 + 10} y={goal.y - goal.r * 0.95 + 18}>{`Шаг: ${goal.missionHud.title.slice(0, 18)}`}</text>
                    <text x={goal.x + goal.r * 0.2 + 10} y={goal.y - goal.r * 0.95 + 37}>{goal.missionHud.costLabel}</text>
                  </g>
                ) : null}
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
