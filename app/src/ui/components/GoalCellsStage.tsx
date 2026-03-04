import { hierarchy, pack, type HierarchyCircularNode } from 'd3-hierarchy'
import { select } from 'd3-selection'
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GoalLinkType } from '../../core/models/goal'
import type { YggdrasilBranch } from './GoalYggdrasilTree'

const DEFAULT_SCENE_WIDTH = 900
const DEFAULT_SCENE_HEIGHT = 560
const FIT_PADDING = 40

const LINK_PRIORITY: GoalLinkType[] = ['conflicts', 'depends_on', 'supports']

interface GoalLinkSatellite {
  goalId: string
  title: string
  type: GoalLinkType
}

interface PackedCircle {
  id: string
  x: number
  y: number
  r: number
  title: string
  priorityBand: YggdrasilBranch['priorityBand']
  isWeak: boolean
  isSelected: boolean
  missionEffectCores: { min: number; max: number }
  missionEffectExpected?: number
  missionDayLabel?: string
  hasActiveMission: boolean
}

interface CellDatum {
  kind: 'goal' | 'kr'
  id: string
  label: string
  value: number
  krId?: string
  priorityBand?: 'low' | 'medium' | 'high'
  isWeak?: boolean
  missionEffect?: { min: number; max: number; expected: number }
  branch?: YggdrasilBranch
  children?: CellDatum[]
}

interface GoalCellsStageProps {
  objective: string
  branches: YggdrasilBranch[]
  selectedBranchId: string | null
  onSelectBranch: (branchId: string) => void
  temperature: 'hot' | 'cold' | 'neutral'
  satellites: GoalLinkSatellite[]
  onSelectSatellite: (goalId: string) => void
  resetSignal?: number
}

function computePackedLayout(width: number, height: number, branches: YggdrasilBranch[]): PackedCircle[] {
  const centerX = width / 2
  const centerY = height / 2
  const shellRadius = Math.max(110, Math.min(width, height) * 0.34)
  if (branches.length === 0) return []

  const normalized = branches.map((branch) => {
    const influenceScore = Math.max(0, branch.rune === 'V' ? 5 : branch.rune === 'IV' ? 4 : branch.rune === 'III' ? 3 : branch.rune === 'II' ? 2 : 1)
    const priorityBoost = branch.priorityBand === 'high' ? 1.15 : branch.priorityBand === 'medium' ? 1 : 0.9
    return {
      branch,
      value: Math.max(1, Math.round(influenceScore * priorityBoost)),
    }
  })

  const root = hierarchy<CellDatum>({
    kind: 'goal',
    id: 'goal-root',
    label: 'goal-root',
    value: 0,
    children: normalized.map((item) => ({
      kind: 'kr',
      id: item.branch.id,
      label: item.branch.title,
      value: item.value,
      krId: item.branch.id,
      priorityBand: item.branch.priorityBand,
      isWeak: item.branch.isWeak,
      missionEffect: {
        min: item.branch.missionEffectCores.min,
        max: item.branch.missionEffectCores.max,
        expected: item.branch.missionEffectExpected ?? Math.round((item.branch.missionEffectCores.min + item.branch.missionEffectCores.max) / 2),
      },
      branch: item.branch,
    })),
  })
    .sum((node) => node.value)

  const packed = pack<CellDatum>()
    .size([shellRadius * 2, shellRadius * 2])
    .padding(8)(root)

  return (packed.children ?? []).map((leaf: HierarchyCircularNode<CellDatum>) => {
    const payload = leaf.data
    if (!payload.branch) {
      throw new Error('Packed KR node must include branch data')
    }
    return {
      id: payload.id,
      x: centerX - shellRadius + leaf.x,
      y: centerY - shellRadius + leaf.y,
      r: Math.max(16, leaf.r),
      title: payload.branch.title,
      priorityBand: payload.branch.priorityBand,
      isWeak: Boolean(payload.branch.isWeak),
      isSelected: false,
      missionEffectCores: payload.branch.missionEffectCores,
      missionEffectExpected: payload.branch.missionEffectExpected,
      missionDayLabel: payload.branch.missionDayLabel,
      hasActiveMission: payload.branch.missions.length > 0,
    }
  })
}

function relationLabel(type: GoalLinkType): string {
  if (type === 'conflicts') return 'конфликт'
  if (type === 'depends_on') return 'зависит от'
  return 'поддерживает'
}

export function GoalCellsStage({ objective, branches, selectedBranchId, onSelectBranch, temperature, satellites, onSelectSatellite, resetSignal = 0 }: GoalCellsStageProps) {
  const [viewSize, setViewSize] = useState({ width: DEFAULT_SCENE_WIDTH, height: DEFAULT_SCENE_HEIGHT })
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity)
  const [isMobile, setIsMobile] = useState(false)
  const sceneRef = useRef<SVGSVGElement | null>(null)
  const sceneWrapRef = useRef<HTMLDivElement | null>(null)
  const viewportRef = useRef<SVGGElement | null>(null)
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null)

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

  const circles = useMemo(() => {
    return computePackedLayout(viewSize.width, viewSize.height, branches.slice(0, 8)).map((circle) => ({
      ...circle,
      isSelected: circle.id === selectedBranchId,
    }))
  }, [branches, selectedBranchId, viewSize.height, viewSize.width])

  const satelliteLayout = useMemo(() => {
    const ranked = [...satellites].sort((a, b) => LINK_PRIORITY.indexOf(a.type) - LINK_PRIORITY.indexOf(b.type))
    const visible = ranked.slice(0, 6)
    const hiddenCount = Math.max(0, ranked.length - visible.length)
    const shellRadius = Math.max(110, Math.min(viewSize.width, viewSize.height) * 0.34)
    const orbitRadius = shellRadius + 84
    const centerX = viewSize.width / 2
    const centerY = viewSize.height / 2
    return {
      hiddenCount,
      nodes: visible.map((item, index) => {
        const angle = (-Math.PI / 2) + (index / Math.max(1, visible.length)) * Math.PI * 2
        return {
          ...item,
          x: centerX + Math.cos(angle) * orbitRadius,
          y: centerY + Math.sin(angle) * orbitRadius,
          r: 28,
        }
      }),
    }
  }, [satellites, viewSize.height, viewSize.width])

  const runFitToView = useCallback(() => {
    if (!sceneRef.current || !viewportRef.current || !zoomRef.current) return
    const sceneBounds = sceneRef.current.getBoundingClientRect()
    const bbox = viewportRef.current.getBBox()
    if (bbox.width <= 0 || bbox.height <= 0 || sceneBounds.width <= 0 || sceneBounds.height <= 0) return
    const availableWidth = Math.max(10, sceneBounds.width - FIT_PADDING * 2)
    const availableHeight = Math.max(10, sceneBounds.height - FIT_PADDING * 2)
    const scale = Math.max(0.65, Math.min(2.2, Math.min(availableWidth / bbox.width, availableHeight / bbox.height)))
    const target = zoomIdentity
      .translate(sceneBounds.width / 2 - (bbox.x + bbox.width / 2) * scale, sceneBounds.height / 2 - (bbox.y + bbox.height / 2) * scale)
      .scale(scale)
    select(sceneRef.current).call(zoomRef.current.transform, target)
  }, [])

  const focusGoal = useCallback(() => {
    if (!sceneRef.current || !zoomRef.current) return
    const centerX = viewSize.width / 2
    const centerY = viewSize.height / 2
    const scale = 1.2
    const target = zoomIdentity.translate(centerX - centerX * scale, centerY - centerY * scale).scale(scale)
    select(sceneRef.current).call(zoomRef.current.transform, target)
  }, [viewSize.height, viewSize.width])

  useEffect(() => {
    if (!sceneRef.current) return
    const behavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.65, 2.4])
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
    requestAnimationFrame(() => runFitToView())
    return () => {
      selection.on('.zoom', null)
    }
  }, [runFitToView, viewSize.height, viewSize.width])

  useEffect(() => {
    runFitToView()
  }, [runFitToView, circles.length, satelliteLayout.nodes.length, viewSize.height, viewSize.width])

  useEffect(() => {
    if (resetSignal > 0) runFitToView()
  }, [resetSignal, runFitToView])

  const selectedCircle = circles.find((item) => item.isSelected) ?? null

  return (
    <div className="goal-cells-stage">
      <div className="goal-cells-stage__head">
        <h2>Goal Cells Stage</h2>
      </div>
      <p className="goal-cells-stage__objective"><strong>Objective:</strong> {objective || 'Уточните цель в Кузнице.'}</p>
      <div className="goal-cells-stage__scene" ref={sceneWrapRef} aria-label="Сцена целей как клеток">
        <div className="goal-cells-stage__floating-controls" role="toolbar" aria-label="Управление сценой">
          <button type="button" className="filter-button" onClick={runFitToView}>{isMobile ? '↺' : 'Сброс вида (R)'}</button>
          <button type="button" className="filter-button" onClick={focusGoal}>{isMobile ? '◎' : 'Фокус на цели'}</button>
        </div>
        <svg ref={sceneRef} viewBox={`0 0 ${viewSize.width} ${viewSize.height}`} role="img" aria-label="Круг цели с внутренними рычагами">
          <defs>
            <radialGradient id="goalCellHot" cx="36%" cy="28%" r="76%">
              <stop offset="0%" stopColor="rgba(255, 240, 187, 0.95)" />
              <stop offset="55%" stopColor="rgba(255, 123, 88, 0.88)" />
              <stop offset="100%" stopColor="rgba(153, 46, 57, 0.84)" />
            </radialGradient>
            <radialGradient id="goalCellCold" cx="36%" cy="28%" r="76%">
              <stop offset="0%" stopColor="rgba(226, 246, 255, 0.95)" />
              <stop offset="55%" stopColor="rgba(111, 162, 255, 0.84)" />
              <stop offset="100%" stopColor="rgba(54, 85, 148, 0.88)" />
            </radialGradient>
            <radialGradient id="goalCellNeutral" cx="36%" cy="28%" r="76%">
              <stop offset="0%" stopColor="rgba(238, 243, 255, 0.9)" />
              <stop offset="100%" stopColor="rgba(122, 130, 170, 0.75)" />
            </radialGradient>
            <filter id="goalCellGlow" x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="6" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          <g transform={transform.toString()} ref={viewportRef}>
            {satelliteLayout.nodes.map((satellite) => (
              <g key={`${satellite.type}-${satellite.goalId}`}>
                <line
                  x1={viewSize.width / 2}
                  y1={viewSize.height / 2}
                  x2={satellite.x}
                  y2={satellite.y}
                  className={`goal-cells-stage__link goal-cells-stage__link--${satellite.type}`}
                />
                <g
                  role="button"
                  tabIndex={0}
                  className="goal-cells-stage__satellite"
                  onClick={() => onSelectSatellite(satellite.goalId)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onSelectSatellite(satellite.goalId)
                    }
                  }}
                  aria-label={`Связь: ${relationLabel(satellite.type)} ${satellite.title}`}
                >
                  <circle cx={satellite.x} cy={satellite.y} r={satellite.r} />
                  <text x={satellite.x} y={satellite.y + 4}>{satellite.title.slice(0, 10)}</text>
                </g>
              </g>
            ))}

            <circle
              className={`goal-cells-stage__shell goal-cells-stage__shell--${temperature}`}
              cx={viewSize.width / 2}
              cy={viewSize.height / 2}
              r={Math.max(110, Math.min(viewSize.width, viewSize.height) * 0.34)}
              filter="url(#goalCellGlow)"
            />

            {circles.map((circle) => {
              const effectLabel = `+${circle.missionEffectCores.min}…${circle.missionEffectCores.max}${circle.missionEffectExpected ? ` (обычно +${circle.missionEffectExpected})` : ''}`
              return (
                <g
                  key={circle.id}
                  className={circle.isSelected ? 'goal-cells-stage__kr goal-cells-stage__kr--selected' : 'goal-cells-stage__kr'}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectBranch(circle.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onSelectBranch(circle.id)
                    }
                  }}
                  aria-label={`Рычаг: ${circle.title}. Приоритет: ${circle.priorityBand === 'high' ? 'высокий' : circle.priorityBand === 'medium' ? 'средний' : 'низкий'}. Слабая: ${circle.isWeak ? 'да' : 'нет'}. Эффект миссии: ${effectLabel}`}
                >
                  <circle className={`goal-cells-stage__kr-halo goal-cells-stage__kr-halo--${circle.priorityBand}`} cx={circle.x} cy={circle.y} r={Math.max(circle.r + 8, 20)} />
                  <circle className="goal-cells-stage__kr-hit" cx={circle.x} cy={circle.y} r={Math.max(circle.r, 20)} />
                  <circle className="goal-cells-stage__kr-core" cx={circle.x} cy={circle.y} r={Math.max(circle.r - 3, 14)} />
                  {circle.isWeak ? (
                    <g className="goal-cells-stage__weak-crack">
                      <path d={`M ${circle.x - circle.r * 0.35} ${circle.y - circle.r * 0.3} L ${circle.x - circle.r * 0.08} ${circle.y - circle.r * 0.06} L ${circle.x + circle.r * 0.2} ${circle.y + circle.r * 0.06} L ${circle.x + circle.r * 0.06} ${circle.y + circle.r * 0.24}`} />
                    </g>
                  ) : null}
                  {!isMobile || circle.isSelected ? <text x={circle.x} y={circle.y + 4}>{circle.title}</text> : null}
                </g>
              )
            })}

            {selectedCircle ? (
              <g className="goal-cells-stage__effect-badge" transform={`translate(${selectedCircle.x + selectedCircle.r + 14}, ${selectedCircle.y - selectedCircle.r * 0.4})`}>
                <rect rx={10} ry={10} width={180} height={selectedCircle.hasActiveMission ? 48 : 28} />
                <text x={10} y={18}>{`+${selectedCircle.missionEffectCores.min}…${selectedCircle.missionEffectCores.max} ядер`}</text>
                <text x={10} y={34}>{selectedCircle.missionEffectExpected ? `(обычно +${selectedCircle.missionEffectExpected})` : ''}</text>
                {selectedCircle.hasActiveMission ? (
                  <g className="goal-cells-stage__mission-fruit">
                    <circle cx={158} cy={16} r={7} />
                    <text x={114} y={42}>{selectedCircle.missionDayLabel ?? 'День 1/3'}</text>
                  </g>
                ) : null}
              </g>
            ) : null}
            {satelliteLayout.hiddenCount > 0 ? <text className="goal-cells-stage__more" x={viewSize.width / 2 - 24} y={viewSize.height * 0.94}>{`+${satelliteLayout.hiddenCount} ещё`}</text> : null}
          </g>
        </svg>
      </div>
    </div>
  )
}
