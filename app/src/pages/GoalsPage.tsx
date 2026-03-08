import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { METRICS, type MetricId } from '../core/metrics'
import type { GoalKeyResult, GoalLinkType, GoalModePresetId, GoalRecord } from '../core/models/goal'
import {
  addGoalEvent,
  createGoal,
  getActiveGoal,
  getLatestRegimeSnapshot,
  getLatestStateSnapshot,
  listCheckins,
  listGoalEvents,
  listGoals,
  setActiveGoal,
  updateGoal,
} from '../core/storage/repo'
import { evaluateGoalScore, type GoalStateInput } from '../core/engines/goal'
import { getLatestForecastRun } from '../repo/forecastRepo'
import { GoalYggdrasilTree, type BranchStrength } from '../ui/components/GoalYggdrasilTree'
import { GoalCellsStage, type UniverseStageGoal, type UniverseStageLink } from '../ui/components/GoalCellsStage'
import { DruidGauge } from './goals/components/DruidGauge'
import { ForgeSheet } from './goals/components/ForgeSheet'
import { PresetSelector } from './goals/components/PresetSelector'
import { RuneDial } from './goals/components/RuneDial'
import { ForgePreview } from './goals/components/ForgePreview'
import { AdvancedTuning } from './goals/components/AdvancedTuning'
import { goalsCopyRu } from './goals/goals.copy.ru'
import { dayKeyFromTs } from '../core/utils/dayKey'
import { buildMissionSuggestion, missionEffectRange, type MissionTag } from './goals/missionPlanner'
import { buildGoalAutoLinkSuggestions } from '../core/engines/goal/autoLinkSuggestions'
import './goals/GoalsSurface.css'

type GoalTemplateId = 'growth' | 'anti-storm' | 'energy-balance' | 'money'

const templates: Record<GoalTemplateId, { title: string; description: string; weights: GoalRecord['weights']; objective: string }> = {
  growth: {
    title: 'Рост',
    description: 'Усилить продуктивность при контроле стресса.',
    objective: 'Расту стабильно без перегрева.',
    weights: { productivity: 0.7, focus: 0.5, stress: -0.7, energy: 0.5 },
  },
  'anti-storm': {
    title: 'Анти-шторм',
    description: 'Снизить риски и стабилизировать систему.',
    objective: 'Удерживаю риски под контролем.',
    weights: { stress: -0.9, sleepHours: 0.6, health: 0.5 },
  },
  'energy-balance': {
    title: 'Баланс энергии',
    description: 'Ровный режим энергии и сна.',
    objective: 'Держу устойчивый ритм.',
    weights: { energy: 0.8, sleepHours: 0.6, stress: -0.5 },
  },
  money: {
    title: 'Деньги',
    description: 'Укрепить финансовый контур без потери ресурса.',
    objective: 'Улучшаю cashflow и контроль решений.',
    weights: { cashFlow: 0.8, productivity: 0.4, stress: -0.4 },
  },
}


const modePresets: Array<{
  id: GoalModePresetId
  title: string
  summary: string
  druidHint: string
  objective: string
  weights: GoalRecord['weights']
  keyMetrics: MetricId[]
}> = [
  {
    id: 'balance',
    title: 'Баланс',
    summary: 'Ровный ритм без перекосов по ресурсам.',
    druidHint: 'Вы выбрали режим Баланс — держим устойчивый темп.',
    objective: 'Держу курс без резких перекосов.',
    weights: { energy: 0.6, sleepHours: 0.6, stress: -0.6, focus: 0.4, productivity: 0.4 },
    keyMetrics: ['energy', 'sleepHours', 'stress'],
  },
  {
    id: 'recovery',
    title: 'Восстановление',
    summary: 'Сон, энергия и стресс — приоритет стабилизации.',
    druidHint: 'Вы выбрали режим Восстановление — укрепляем базовый ресурс.',
    objective: 'Восстанавливаю энергию и снижаю турбулентность.',
    weights: { sleepHours: 0.9, energy: 0.9, stress: -0.9, health: 0.5 },
    keyMetrics: ['sleepHours', 'energy', 'stress'],
  },
  {
    id: 'sprint',
    title: 'Спринт',
    summary: 'Фокус и продуктивность с ограничением шторма.',
    druidHint: 'Вы выбрали режим Спринт — ускоряемся, но шторм держим под контролем.',
    objective: 'Выполняю спринт без срыва в перегрев.',
    weights: { focus: 0.95, productivity: 0.9, stress: -0.65, energy: 0.5 },
    keyMetrics: ['focus', 'productivity', 'stress'],
  },
  {
    id: 'finance',
    title: 'Финансы',
    summary: 'Денежный поток и обязательства без хаоса.',
    druidHint: 'Вы выбрали режим Финансы — усиливаем денежный контур.',
    objective: 'Стабилизирую денежный поток и обязательства.',
    weights: { cashFlow: 0.95, productivity: 0.45, stress: -0.5, focus: 0.35 },
    keyMetrics: ['cashFlow', 'productivity', 'stress'],
  },
  {
    id: 'social-shield',
    title: 'Социальный щит',
    summary: 'Настроение и социальность как защита от просадки.',
    druidHint: 'Вы выбрали режим Социальный щит — укрепляем настроение и контакт.',
    objective: 'Поддерживаю настроение и опору на окружение.',
    weights: { mood: 0.85, social: 0.85, stress: -0.55, energy: 0.35 },
    keyMetrics: ['mood', 'social', 'stress'],
  },
]

const modePresetsMap = Object.fromEntries(modePresets.map((preset) => [preset.id, preset])) as Record<GoalModePresetId, (typeof modePresets)[number]>

type ForestTab = 'active' | 'archived' | 'trashed'
const forestTabLabels: Record<ForestTab, string> = {
  active: 'Активные',
  archived: 'Архив',
  trashed: 'Корзина',
}

const goalStatusBadgeLabel: Record<GoalRecord['status'], string> = {
  active: 'Активна',
  archived: 'Архив',
  trashed: 'Корзина',
}

const linkTypeLabels: Record<GoalLinkType, string> = {
  supports: 'Помогает',
  depends_on: 'Зависит от',
  conflicts: 'Конфликтует',
}


const UNIVERSE_SEED_BLUEPRINTS: Array<{
  id: string
  title: string
  description: string
  objective: string
  weights: GoalRecord['weights']
  leverMetrics: MetricId[]
}> = [
  {
    id: 'goal-universe-01-north-star',
    title: 'Демо · Северная звезда',
    description: 'Демо-цель для плотной карты сцены.',
    objective: 'Держу долгий курс без потери темпа.',
    weights: { focus: 0.8, productivity: 0.7, stress: -0.5, energy: 0.45, sleepHours: 0.3 },
    leverMetrics: ['focus', 'productivity', 'stress', 'energy', 'sleepHours'],
  },
  {
    id: 'goal-universe-02-energy-loop',
    title: 'Демо · Энергоконтур',
    description: 'Демо-цель для плотной карты сцены.',
    objective: 'Стабилизирую энергию и сон на дистанции.',
    weights: { energy: 0.9, sleepHours: 0.85, stress: -0.7, mood: 0.35 },
    leverMetrics: ['energy', 'sleepHours', 'stress', 'mood'],
  },
  {
    id: 'goal-universe-03-finance-grid',
    title: 'Демо · Финконтур',
    description: 'Демо-цель для плотной карты сцены.',
    objective: 'Укрепляю денежный поток без хаоса.',
    weights: { cashFlow: 0.95, focus: 0.45, productivity: 0.5, stress: -0.35 },
    leverMetrics: ['cashFlow', 'focus', 'productivity', 'stress'],
  },
  {
    id: 'goal-universe-04-social-shield',
    title: 'Демо · Соцщит',
    description: 'Демо-цель для плотной карты сцены.',
    objective: 'Поддерживаю контакт и ресурс команды.',
    weights: { social: 0.9, mood: 0.8, stress: -0.45, energy: 0.35 },
    leverMetrics: ['social', 'mood', 'stress', 'energy'],
  },
  {
    id: 'goal-universe-05-deep-work',
    title: 'Демо · Глубокая работа',
    description: 'Демо-цель для плотной карты сцены.',
    objective: 'Создаю блоки глубокой работы каждый день.',
    weights: { focus: 0.95, productivity: 0.8, social: -0.2, stress: -0.3 },
    leverMetrics: ['focus', 'productivity', 'stress', 'sleepHours'],
  },
  {
    id: 'goal-universe-06-recovery',
    title: 'Демо · Восстановление',
    description: 'Демо-цель для плотной карты сцены.',
    objective: 'Восстанавливаюсь и держу шторм ниже порога.',
    weights: { health: 0.8, sleepHours: 0.9, energy: 0.7, stress: -0.9, mood: 0.4 },
    leverMetrics: ['health', 'sleepHours', 'energy', 'stress', 'mood'],
  },
  {
    id: 'goal-universe-07-balance-grid',
    title: 'Демо · Баланс системы',
    description: 'Демо-цель для плотной карты сцены.',
    objective: 'Собираю баланс по ключевым метрикам.',
    weights: { energy: 0.55, focus: 0.55, productivity: 0.55, stress: -0.55, cashFlow: 0.35, social: 0.35 },
    leverMetrics: ['energy', 'focus', 'productivity', 'stress', 'cashFlow', 'social'],
  },
]

function buildPresetKrs(presetId: GoalModePresetId): GoalKeyResult[] {
  const preset = modePresetsMap[presetId]
  return preset.keyMetrics.map((metricId, index) => createKrFromMetric(metricId, (preset.weights[metricId] ?? 0) >= 0 ? 'up' : 'down', index, `Ключевая ветвь режима «${preset.title}».`))
}



const forgeRuneMetricIds: MetricId[] = ['energy', 'focus', 'productivity', 'sleepHours', 'stress', 'mood', 'social', 'cashFlow']
const runeStateLabels = ['Низко', 'Низко', 'Норм', 'Норм', 'Сильно', 'Макс'] as const

function weightToRuneLevel(weight: number): number {
  const normalized = Math.min(1, Math.max(0, Math.abs(weight)))
  return Math.round(normalized * 5)
}

function runeLevelToWeight(level: number, sign: -1 | 1): number {
  return Math.max(0, Math.min(5, level)) / 5 * sign
}

function getWeatherLabel(levelAvg: number): 'Штиль' | 'Ветер' | 'Шторм' {
  if (levelAvg <= 1.8) return 'Штиль'
  if (levelAvg <= 3.6) return 'Ветер'
  return 'Шторм'
}

function getRiskLabel(levelAvg: number): 'Низкий' | 'Средний' | 'Высокий' {
  if (levelAvg <= 2) return 'Низкий'
  if (levelAvg <= 3.8) return 'Средний'
  return 'Высокий'
}

const MISSION_REROLL_LIMIT_PER_DAY = 2
const MISSION_REROLL_COOLDOWN_MS = 30_000

function missionProgressLabel(startedAt: number, durationDays: 1 | 3): string {
  const passedDays = Math.max(1, Math.ceil((Date.now() - startedAt) / (24 * 60 * 60 * 1000) + 0.01))
  const capped = Math.min(durationDays, passedDays)
  return `День ${capped}/${durationDays}`
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function createKrFromMetric(metricId: MetricId, direction: 'up' | 'down', index: number, note: string): GoalKeyResult {
  return {
    id: `kr-${metricId}-${index}`,
    metricId,
    direction,
    progressMode: 'auto',
    note,
  }
}

function ensureGoalKeyResults(goal: GoalRecord, goalState: GoalStateInput | null): GoalKeyResult[] {
  if (goal.okr.keyResults.length > 0) {
    return goal.okr.keyResults.slice(0, 5)
  }

  const fallbackMetrics: Array<{ metricId: MetricId; direction: 'up' | 'down' }> = [
    { metricId: 'energy', direction: 'up' },
    { metricId: 'sleepHours', direction: 'up' },
    { metricId: 'stress', direction: 'down' },
  ]

  const hasData = goalState ? fallbackMetrics.every((row) => typeof goalState.metrics[row.metricId] === 'number') : false
  if (hasData) {
    return fallbackMetrics.map((row, index) => createKrFromMetric(row.metricId, row.direction, index, 'Временная ветвь из текущих метрик.'))
  }

  return Object.entries(goal.weights)
    .slice(0, 3)
    .map(([metricId, weight], index) => createKrFromMetric(metricId as MetricId, (weight ?? 0) >= 0 ? 'up' : 'down', index, 'Создано из веса метрики.'))
}

export function GoalsPage() {
  const navigate = useNavigate()
  const [goals, setGoals] = useState<GoalRecord[]>([])
  const [goalsLoaded, setGoalsLoaded] = useState(false)
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null)
  const [editor, setEditor] = useState<GoalRecord | null>(null)
  const [goalState, setGoalState] = useState<GoalStateInput | null>(null)
  const [historyTrend, setHistoryTrend] = useState<'up' | 'down' | null>(null)
  const [selectedKrId, setSelectedKrId] = useState<string | null>(null)
  const [stageResetSignal, setStageResetSignal] = useState(0)
  const goalsStageMode = 'cells' as const
  const [seedModalOpen, setSeedModalOpen] = useState(false)
  const [seedTemplate, setSeedTemplate] = useState<GoalTemplateId>('growth')
  const [seedTitle, setSeedTitle] = useState('')
  const [seedHorizon, setSeedHorizon] = useState<7 | 14 | 30>(14)
  const [duplicateCandidate, setDuplicateCandidate] = useState<GoalRecord | null>(null)
  const [forestTab, setForestTab] = useState<ForestTab>('active')
  const [forestSearch, setForestSearch] = useState('')
  const [forestGroveFilter, setForestGroveFilter] = useState<string>('all')
  const [rootsStageEnabled, setRootsStageEnabled] = useState(false)
  const [forestMenuGoalId, setForestMenuGoalId] = useState<string | null>(null)
  const [forestMenuStyle, setForestMenuStyle] = useState<CSSProperties | null>(null)
  const forestMenuTriggerRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const forestMenuItemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const forestListRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    setForestMenuGoalId(null)
    setForestMenuStyle(null)
  }, [forestTab, goals])

  const [linkModalOpen, setLinkModalOpen] = useState(false)
  const [linkSearch, setLinkSearch] = useState('')
  const [linkTargetId, setLinkTargetId] = useState('')
  const [linkTypeDraft, setLinkTypeDraft] = useState<GoalLinkType>('supports')
  const [isForgeOpen, setIsForgeOpen] = useState(false)
  const [showDebugNumbers, setShowDebugNumbers] = useState(false)
  const [devUnlocked, setDevUnlocked] = useState(false)
  const forensicsEnabled = devUnlocked && !import.meta.env.PROD
  const lastUserInputAtRef = useRef(0)
  const lastAutoMoveCauseRef = useRef<'fit' | 'focus' | 'scrollIntoView' | 'scrollRestoration' | 'unknown'>('unknown')
  const autoMoveEventsRef = useRef<Array<{ method: string; args: unknown[]; stack?: string; at: number }>>([])
  useEffect(() => {
    if (typeof window === 'undefined') return
    const syncDebug = () => setDevUnlocked(window.localStorage.getItem('cc_debug') === '1')
    syncDebug()
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey && event.key.toLowerCase() === 'd') {
        const next = window.localStorage.getItem('cc_debug') === '1' ? '0' : '1'
        window.localStorage.setItem('cc_debug', next)
        setDevUnlocked(next === '1')
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('storage', syncDebug)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('storage', syncDebug)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const markUserInput = () => {
      lastUserInputAtRef.current = Date.now()
    }
    const events: Array<keyof WindowEventMap> = ['wheel', 'touchstart', 'keydown', 'mousedown']
    events.forEach((name) => window.addEventListener(name, markUserInput, { passive: true }))
    return () => events.forEach((name) => window.removeEventListener(name, markUserInput))
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return

    window.scrollTo(0, 0)

    let previousScrollRestoration: ScrollRestoration | null = null
    if ('scrollRestoration' in window.history) {
      previousScrollRestoration = window.history.scrollRestoration
      window.history.scrollRestoration = 'manual'
    }

    return () => {
      if (previousScrollRestoration) window.history.scrollRestoration = previousScrollRestoration
    }
  }, [])

  useEffect(() => {
    if (!forensicsEnabled || typeof window === 'undefined') return
    const win = window as Window & {
      __ccAutoMovePatched?: boolean
      __ccAutoMoveRestore?: () => void
    }
    if (win.__ccAutoMovePatched) return
    const originals = {
      focus: HTMLElement.prototype.focus,
      scrollIntoView: Element.prototype.scrollIntoView,
    }
    const focusDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'focus')
    if (!focusDescriptor || focusDescriptor.writable === false || focusDescriptor.configurable === false) {
      console.debug('[AUTO-MOVE] cannot patch HTMLElement.prototype.focus')
      return
    }

    const scrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')
    if (!scrollIntoViewDescriptor || scrollIntoViewDescriptor.writable === false || scrollIntoViewDescriptor.configurable === false) {
      console.debug('[AUTO-MOVE] cannot patch Element.prototype.scrollIntoView')
      return
    }

    const recent = autoMoveEventsRef.current
    const pushEvent = (method: string, args: unknown[]) => {
      try {
        const event = { method, args, stack: new Error().stack, at: Date.now() }
        recent.push(event)
        while (recent.length > 5) recent.shift()
        const now = Date.now()
        const userInitiated = now - lastUserInputAtRef.current <= 120
        if (!userInitiated) {
          const cause = method === 'scrollIntoView'
            ? 'scrollIntoView'
            : method === 'focus'
              ? 'focus'
              : 'unknown'
          lastAutoMoveCauseRef.current = cause
          window.dispatchEvent(new CustomEvent('cc:auto-move-cause', { detail: { cause } }))
        }
        console.debug('[AUTO-MOVE]', recent.map((item) => ({ method: item.method, at: item.at, args: item.args, stack: item.stack })))
      } catch (error) {
        console.debug('[AUTO-MOVE] log failure', error)
      }
    }

    HTMLElement.prototype.focus = function patchedFocus(...args: Parameters<HTMLElement['focus']>) {
      pushEvent('focus', args as unknown[])
      return originals.focus.call(this, ...args)
    }
    Element.prototype.scrollIntoView = function patchedScrollIntoView(...args: Parameters<Element['scrollIntoView']>) {
      pushEvent('scrollIntoView', args as unknown[])
      return originals.scrollIntoView.call(this, ...args)
    }

    win.__ccAutoMovePatched = true
    win.__ccAutoMoveRestore = () => {
      HTMLElement.prototype.focus = originals.focus
      Element.prototype.scrollIntoView = originals.scrollIntoView
      win.__ccAutoMovePatched = false
    }

    return () => {
      win.__ccAutoMoveRestore?.()
      delete win.__ccAutoMoveRestore
    }
  }, [forensicsEnabled])

  useEffect(() => {
    if (!forensicsEnabled || typeof window === 'undefined') return
    const onScroll = () => {
      try {
        console.debug('[AUTO-MOVE] scroll', { y: window.scrollY, x: window.scrollX, at: Date.now() })
      } catch (error) {
        console.debug('[AUTO-MOVE] scroll log failure', error)
      }
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [forensicsEnabled])
  const forgeOpenButtonRef = useRef<HTMLButtonElement | null>(null)
  const [nextMissionDuration, setNextMissionDuration] = useState<1 | 3>(3)
  const [missionSuggestionSalt, setMissionSuggestionSalt] = useState(0)
  const [missionDetailsOpen, setMissionDetailsOpen] = useState(false)
  const [cockpitMissionFlash, setCockpitMissionFlash] = useState(false)
  const [missionConfirmOpen, setMissionConfirmOpen] = useState(false)
  const [missionAwardDraft, setMissionAwardDraft] = useState(5)
  const [submenuOpen, setSubmenuOpen] = useState<'search' | 'filter' | 'roots' | 'forge' | null>(null)
  const submenuTriggerRefs = useRef<Record<'search' | 'filter' | 'roots' | 'forge', HTMLButtonElement | null>>({
    search: null,
    filter: null,
    roots: null,
    forge: null,
  })
  const submenuPopoverRef = useRef<HTMLDivElement | null>(null)
  const [supportsExpanded, setSupportsExpanded] = useState(false)
  const [hiddenAutoSuggestionKeys, setHiddenAutoSuggestionKeys] = useState<Record<string, true>>({})
  const [suggestionTypeDraftByGoalId, setSuggestionTypeDraftByGoalId] = useState<Record<string, GoalLinkType>>({})
  const [hiddenConflictDayKeyByGoal, setHiddenConflictDayKeyByGoal] = useState<Record<string, string>>({})
  const seedButtonRef = useRef<HTMLButtonElement | null>(null)
  const seedDialogRef = useRef<HTMLDivElement | null>(null)
  const missionDoneButtonRef = useRef<HTMLButtonElement | null>(null)
  const missionConfirmDialogRef = useRef<HTMLDivElement | null>(null)

  const reload = async () => {
    const [allGoals, active, latestState, latestRegime, checkins, latestForecast] = await Promise.all([
      listGoals(),
      getActiveGoal(),
      getLatestStateSnapshot(),
      getLatestRegimeSnapshot(),
      listCheckins(),
      getLatestForecastRun(),
    ])

    setGoals(allGoals)
    const picked = allGoals.find((item) => item.id === selectedGoalId) ?? active ?? allGoals[0] ?? null
    setSelectedGoalId(picked?.id ?? null)
    setEditor(picked)

    if (!latestState || !latestRegime || !checkins[0]) {
      setGoalState(null)
      return
    }

    const latestCheckin = checkins[0]
    const metrics = METRICS.reduce((acc, metric) => {
      acc[metric.id] = latestCheckin[metric.id]
      return acc
    }, {} as GoalStateInput['metrics'])

    const currentState: GoalStateInput = {
      index: latestState.index,
      pCollapse: latestRegime.pCollapse,
      entropy: latestState.entropy,
      drift: latestState.drift,
      stats: latestState.stats,
      metrics,
      forecast: latestForecast
        ? {
          p10: latestForecast.index.p10.at(-1),
          p50: latestForecast.index.p50.at(-1),
          p90: latestForecast.index.p90.at(-1),
        }
        : undefined,
    }

    setGoalState(currentState)

    if (picked?.id) {
      const rows = await listGoalEvents(picked.id, 2)
      setHistoryTrend(rows.length >= 2 && rows[0].goalScore >= rows[1].goalScore ? 'up' : rows.length >= 2 ? 'down' : null)
    }

    setGoalsLoaded(true)
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selected = useMemo(() => goals.find((item) => item.id === selectedGoalId) ?? null, [goals, selectedGoalId])
  const goalTitleMap = useMemo(() => new Map(goals.map((goal) => [goal.id, goal.title])), [goals])

  const selectedLinksByType = useMemo(() => {
    const grouped: Record<GoalLinkType, Array<{ toGoalId: string; type: GoalLinkType }>> = {
      supports: [],
      depends_on: [],
      conflicts: [],
    }
    for (const link of selected?.links ?? []) {
      if (!goalTitleMap.has(link.toGoalId)) continue
      grouped[link.type].push(link)
    }
    return grouped
  }, [goalTitleMap, selected?.links])

  const selectedLinkedTargets = useMemo(() => {
    return (selected?.links ?? [])
      .map((link) => ({
        ...link,
        title: goalTitleMap.get(link.toGoalId) ?? null,
      }))
      .filter((item) => Boolean(item.title))
  }, [goalTitleMap, selected?.links])

  const linkCandidates = useMemo(() => {
    const query = linkSearch.trim().toLowerCase()
    return goals
      .filter((goal) => goal.id !== selected?.id && goal.status !== 'trashed')
      .filter((goal) => !query || goal.title.toLowerCase().includes(query))
  }, [goals, linkSearch, selected?.id])

  const supportsLinkedGoals = useMemo(() => {
    const ids = new Set((selectedLinksByType.supports ?? []).map((item) => item.toGoalId))
    return goals.filter((goal) => ids.has(goal.id))
  }, [goals, selectedLinksByType.supports])

  const conflictLinkedGoals = useMemo(() => {
    const ids = new Set((selectedLinksByType.conflicts ?? []).map((item) => item.toGoalId))
    return goals.filter((goal) => ids.has(goal.id) && goal.status === 'active')
  }, [goals, selectedLinksByType.conflicts])

  const dependsLinkedGoals = useMemo(() => {
    const ids = new Set((selectedLinksByType.depends_on ?? []).map((item) => item.toGoalId))
    return goals.filter((goal) => ids.has(goal.id))
  }, [goals, selectedLinksByType.depends_on])

  const autoLinkSuggestions = useMemo(() => {
    if (!selected) return []
    return buildGoalAutoLinkSuggestions(selected, goals)
      .filter((item) => !hiddenAutoSuggestionKeys[`${item.sourceGoalId}->${item.targetGoalId}`])
  }, [goals, hiddenAutoSuggestionKeys, selected])

  const conflictAvoidTags = useMemo(() => {
    const tags = new Set<MissionTag>()
    for (const goal of conflictLinkedGoals) {
      const weights = goal.manualTuning?.weights ?? goal.weights
      if ((weights.energy ?? 0) > 0) tags.add('energy')
      if ((weights.sleepHours ?? 0) > 0) tags.add('sleep')
      if ((weights.cashFlow ?? 0) > 0) tags.add('money')
      if ((weights.focus ?? 0) > 0 || (weights.productivity ?? 0) > 0) tags.add('focus')
      if ((weights.social ?? 0) > 0 || (weights.mood ?? 0) > 0) tags.add('social')
      if ((weights.stress ?? 0) < 0) tags.add('stress')
    }
    return Array.from(tags)
  }, [conflictLinkedGoals])

  useEffect(() => {
    setSupportsExpanded(false)
  }, [selected?.id])


  const selectedPreset = useMemo(() => {
    const presetId = selected?.modePresetId ?? 'balance'
    return modePresetsMap[presetId]
  }, [selected?.modePresetId])

  const selectedWeights = useMemo(() => {
    if (!selected) return {}
    if (selected.isManualTuning) {
      return selected.manualTuning?.weights ?? selected.weights
    }
    return selectedPreset.weights
  }, [selected, selectedPreset])

  const forgeRunes = useMemo(() => {
    return forgeRuneMetricIds.map((metricId) => {
      const metric = METRICS.find((item) => item.id === metricId)
      const weight = selectedWeights[metricId] ?? 0
      return {
        metricId,
        label: metric?.labelRu ?? metricId,
        level: weightToRuneLevel(weight),
        sign: ((weight || metricId === 'stress' ? Math.sign(weight || -1) : 1) >= 0 ? 1 : -1) as -1 | 1,
      }
    })
  }, [selectedWeights])

  const forgePreview = useMemo(() => {
    const levels = forgeRunes.map((item) => item.level)
    const levelAvg = levels.length ? levels.reduce((acc, value) => acc + value, 0) / levels.length : 0
    const coresMin = Math.max(1, Math.round(levelAvg * 1.5))
    const coresMax = coresMin + 4 + Math.round(levelAvg)
    return {
      coresMin,
      coresMax,
      weather: getWeatherLabel(levelAvg),
      risk: getRiskLabel(levelAvg),
    }
  }, [forgeRunes])

  const patchGoalInState = (goalId: string, patch: Partial<GoalRecord>) => {
    setGoals((current) => current.map((goal) => (goal.id === goalId ? { ...goal, ...patch } : goal)))
    setEditor((current) => (current?.id === goalId ? { ...current, ...patch } : current))
  }

  const applyModePreset = async (presetId: GoalModePresetId) => {
    if (!selected) return
    const preset = modePresetsMap[presetId]
    const goalPatch: Partial<GoalRecord> = {
      modePresetId: presetId,
      isManualTuning: false,
      weights: preset.weights,
      okr: {
        ...selected.okr,
        objective: preset.objective,
        keyResults: buildPresetKrs(presetId),
      },
      activeMission: undefined,
    }
    patchGoalInState(selected.id, goalPatch)
    await updateGoal(selected.id, goalPatch)
  }

  const toggleManualTuning = async () => {
    if (!selected) return
    if (selected.isManualTuning) {
      const fallbackPresetId = selected.modePresetId ?? 'balance'
      const preset = modePresetsMap[fallbackPresetId]
      const goalPatch: Partial<GoalRecord> = {
        isManualTuning: false,
        modePresetId: fallbackPresetId,
        weights: preset.weights,
      }
      patchGoalInState(selected.id, goalPatch)
      await updateGoal(selected.id, goalPatch)
      return
    }

    const manualWeights = selected.manualTuning?.weights ?? selected.weights
    const goalPatch: Partial<GoalRecord> = {
      isManualTuning: true,
      modePresetId: undefined,
      weights: manualWeights,
      manualTuning: {
        weights: manualWeights,
        horizonDays: selected.manualTuning?.horizonDays ?? selected.horizonDays,
        krDirections: selected.manualTuning?.krDirections,
      },
    }
    patchGoalInState(selected.id, goalPatch)
    await updateGoal(selected.id, goalPatch)
  }

  const applyRuneLevel = async (metricId: MetricId, level: number) => {
    if (!selected) return
    const current = selectedWeights[metricId] ?? 0
    const sign = (current < 0 || metricId === 'stress' ? -1 : 1) as -1 | 1
    const nextWeight = runeLevelToWeight(level, sign)
    const nextWeights = { ...selectedWeights, [metricId]: nextWeight }

    const goalPatch: Partial<GoalRecord> = {
      isManualTuning: true,
      modePresetId: undefined,
      weights: nextWeights,
      manualTuning: {
        weights: nextWeights,
        horizonDays: selected.manualTuning?.horizonDays ?? selected.horizonDays,
        krDirections: selected.manualTuning?.krDirections,
      },
    }
    patchGoalInState(selected.id, goalPatch)
    await updateGoal(selected.id, goalPatch)
  }

  const resetManualToPreset = async () => {
    if (!selected) return
    const fallbackPresetId = selected.modePresetId ?? 'balance'
    await applyModePreset(fallbackPresetId)
  }

  const scoring = useMemo(() => {
    if (!selected || !goalState) return null
    return evaluateGoalScore(selected, goalState)
  }, [selected, goalState])

  const treeState = useMemo(() => {
    if (!scoring) return null
    if (scoring.goalGap <= -5) return { label: 'Растёт', toneClass: 'status-badge--low' }
    if (scoring.goalGap <= 2) return { label: 'Штормит', toneClass: 'status-badge--mid' }
    return { label: 'Стоит', toneClass: 'status-badge--high' }
  }, [scoring])


  useEffect(() => {
    let cancelled = false
    const run = async () => {
      if (!selected || !goalState) return
      if (cancelled) return
      if (scoring) {
        await addGoalEvent({ goalId: selected.id, goalScore: scoring.goalScore, goalGap: scoring.goalGap })
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [selected, goalState, scoring])

  const startSeed = () => {
    setSeedModalOpen(true)
    setSeedTemplate('growth')
    setSeedTitle('')
    setSeedHorizon(14)
    setDuplicateCandidate(null)
  }


  const seedUniverse = async () => {
    const existingById = new Map(goals.map((goal) => [goal.id, goal]))

    for (const [index, blueprint] of UNIVERSE_SEED_BLUEPRINTS.entries()) {
      const keyResults = blueprint.leverMetrics.map((metricId, metricIndex) => {
        const weight = blueprint.weights[metricId] ?? 0
        return {
          ...createKrFromMetric(metricId, weight >= 0 ? 'up' : 'down', metricIndex, 'Детерминированный рычаг демо-засева.'),
          id: `kr-universe-${index + 1}-${metricId}`,
        }
      })

      const patch = {
        title: blueprint.title,
        description: blueprint.description,
        horizonDays: 14 as const,
        status: 'active' as const,
        template: 'growth' as const,
        weights: blueprint.weights,
        okr: { objective: blueprint.objective, keyResults },
        modePresetId: 'balance' as const,
        isManualTuning: false,
        manualTuning: { weights: blueprint.weights, horizonDays: 14 as const },
        groveId: 'Демо-роща',
      }

      const existing = existingById.get(blueprint.id)
      if (existing) {
        await updateGoal(existing.id, patch)
      } else {
        await createGoal({ id: blueprint.id, ...patch })
      }
    }

    await setActiveGoal(UNIVERSE_SEED_BLUEPRINTS[0].id)
    setSelectedGoalId(UNIVERSE_SEED_BLUEPRINTS[0].id)
    setForestTab('active')
    await reload()
  }

  const closeSeedModal = () => {
    setSeedModalOpen(false)
    setDuplicateCandidate(null)
    requestAnimationFrame(() => seedButtonRef.current?.focus({ preventScroll: true }))
  }

  useEffect(() => {
    if (!seedModalOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const focusableSelectors = [
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',')

    const node = seedDialogRef.current
    const focusable = node ? Array.from(node.querySelectorAll<HTMLElement>(focusableSelectors)) : []
    focusable[0]?.focus({ preventScroll: true })

    const onKeyDown = (event: KeyboardEvent) => {
      if (!seedModalOpen) return
      if (event.key === 'Escape') {
        event.preventDefault()
        closeSeedModal()
        return
      }
      if (event.key !== 'Tab') return
      const dialogNode = seedDialogRef.current
      if (!dialogNode) return
      const trapped = Array.from(dialogNode.querySelectorAll<HTMLElement>(focusableSelectors))
      if (trapped.length === 0) return
      const first = trapped[0]
      const last = trapped[trapped.length - 1]
      const active = document.activeElement
      if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus({ preventScroll: true })
      } else if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus({ preventScroll: true })
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [seedModalOpen])

  const submitSeed = async (forceCreate = false) => {
    const normalizedTitle = seedTitle.trim()
    if (!normalizedTitle) return
    const duplicate = goals.find((item) => item.status === 'active' && item.title.trim().toLowerCase() === normalizedTitle.toLowerCase())
    if (duplicate && !forceCreate) {
      setDuplicateCandidate(duplicate)
      return
    }

    const tpl = templates[seedTemplate]
    const keyResults = Object.entries(tpl.weights)
      .slice(0, 3)
      .map(([metricId, weight], index) => createKrFromMetric(metricId as MetricId, (weight ?? 0) >= 0 ? 'up' : 'down', index, 'Создано из шаблона.'))

    const created = await createGoal({
      title: normalizedTitle,
      description: tpl.description,
      horizonDays: seedHorizon,
      status: 'active',
      template: seedTemplate,
      weights: tpl.weights,
      okr: { objective: tpl.objective, keyResults },
      modePresetId: 'balance',
      isManualTuning: false,
      manualTuning: { weights: tpl.weights, horizonDays: seedHorizon },
    })

    await setActiveGoal(created.id)
    setSeedModalOpen(false)
    setDuplicateCandidate(null)
    setSelectedGoalId(created.id)
    await reload()
  }

  const selectedKrs = useMemo(() => {
    if (!selected) return []
    if (selected.isManualTuning) {
      return ensureGoalKeyResults(selected, goalState)
    }
    return buildPresetKrs(selectedPreset.id)
  }, [selected, goalState, selectedPreset.id])

  useEffect(() => {
    if (selectedKrs.length === 0) {
      setSelectedKrId(null)
      return
    }

    if (selectedKrId && selectedKrs.some((item) => item.id === selectedKrId)) {
      return
    }

    setSelectedKrId(null)
  }, [selectedKrId, selectedKrs])

  const krProgressRows = useMemo(() => {
    return selectedKrs.map((kr) => {
      const metric = METRICS.find((item) => item.id === kr.metricId)
      const metricValue = goalState?.metrics[kr.metricId] ?? (metric ? (metric.min + metric.max) / 2 : 0)
      const baseProgress = metric
        ? kr.direction === 'up'
          ? clamp01((metricValue - metric.min) / (metric.max - metric.min || 1))
          : clamp01((metric.max - metricValue) / (metric.max - metric.min || 1))
        : 0
      const targetProgress = typeof kr.target === 'number'
        ? (kr.direction === 'up' ? clamp01(metricValue / (kr.target || 1)) : metricValue <= kr.target ? 1 : clamp01((kr.target || 1) / (metricValue || 1)))
        : baseProgress
      const progress = kr.progressMode === 'manual' && typeof kr.progress === 'number'
        ? clamp01(kr.progress)
        : targetProgress

      return { kr, progress }
    })
  }, [goalState, selectedKrs])

  const weakestKr = useMemo(() => {
    if (krProgressRows.length === 0) return null
    return [...krProgressRows].sort((a, b) => a.progress - b.progress)[0]
  }, [krProgressRows])

  const selectedKrRow = useMemo(() => {
    if (!selectedKrId) return null
    return krProgressRows.find((row) => row.kr.id === selectedKrId) ?? null
  }, [krProgressRows, selectedKrId])

  const selectedKrMetricLabel = useMemo(() => {
    if (!selectedKrRow) return null
    return METRICS.find((item) => item.id === selectedKrRow.kr.metricId)?.labelRu ?? selectedKrRow.kr.metricId
  }, [selectedKrRow])

  const missionTargetKr = selectedKrRow ?? weakestKr ?? null

  const missionRecentTemplateIds = useMemo(() => {
    if (!selected || !missionTargetKr) return []
    const historyTemplateIds = (selected.missionHistory ?? [])
      .filter((item) => item.krKey === missionTargetKr.kr.id && typeof item.templateId === 'string')
      .slice(0, 5)
      .map((item) => item.templateId as string)
    const suggestionTemplateIds = (selected.missionControl?.lastSuggestions ?? [])
      .filter((item) => item.krKey === missionTargetKr.kr.id)
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 5)
      .map((item) => item.templateId)
    return [...new Set([...historyTemplateIds, ...suggestionTemplateIds])]
  }, [selected, missionTargetKr])

  const nextMissionTemplate = useMemo(() => {
    if (!missionTargetKr) return null
    return buildMissionSuggestion({
      metricId: missionTargetKr.kr.metricId,
      presetId: selected?.modePresetId ?? 'balance',
      durationDays: nextMissionDuration,
      excludedTemplateIds: missionRecentTemplateIds,
      avoidTags: conflictAvoidTags,
      salt: missionSuggestionSalt + missionTargetKr.kr.id.length,
    })
  }, [conflictAvoidTags, missionTargetKr, missionRecentTemplateIds, missionSuggestionSalt, nextMissionDuration, selected?.modePresetId])

  const nextMissionEffect = useMemo(() => {
    if (!nextMissionTemplate) return null
    return missionEffectRange(nextMissionDuration, nextMissionTemplate.effectProfile)
  }, [nextMissionDuration, nextMissionTemplate])

  const nextMissionTitle = nextMissionTemplate?.title ?? (missionTargetKr ? `Ритуал по ветви «${selectedKrMetricLabel ?? missionTargetKr.kr.metricId}»` : 'Выберите ветвь на сцене, чтобы получить миссию.')

  const currentDayKey = dayKeyFromTs(Date.now())
  const isConflictHiddenToday = selected ? hiddenConflictDayKeyByGoal[selected.id] === currentDayKey : false
  const rerollsUsedToday = selected?.missionControl?.rerollDayKey === currentDayKey ? (selected?.missionControl?.rerollsUsed ?? 0) : 0
  const lastRerollAt = selected?.missionControl?.lastRerollAt ?? 0
  const rerollCooldownLeftMs = Math.max(0, MISSION_REROLL_COOLDOWN_MS - (Date.now() - lastRerollAt))
  const canReroll = Boolean(missionTargetKr && !selected?.activeMission && rerollsUsedToday < MISSION_REROLL_LIMIT_PER_DAY && rerollCooldownLeftMs === 0)
  const activeMission = selected?.activeMission
  const missionProgress = activeMission ? missionProgressLabel(activeMission.startedAt, activeMission.durationDays) : null
  const missionHistory = selected?.missionHistory ?? []

  const closeForge = () => {
    setIsForgeOpen(false)
    requestAnimationFrame(() => forgeOpenButtonRef.current?.focus({ preventScroll: true }))
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'r') return
      const target = event.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      event.preventDefault()
      setStageResetSignal((value) => value + 1)
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])


  const focusCockpitMission = () => {
    setCockpitMissionFlash(true)
    window.setTimeout(() => setCockpitMissionFlash(false), 1000)
  }

  const trunkHealth = useMemo(() => {
    if (!scoring) return { label: '—', stateKind: 'na' as const, value01: null }
    if (scoring.goalGap <= -5) return { label: 'Норма', stateKind: 'good' as const, value01: 0.8 }
    if (scoring.goalGap <= 2) return { label: 'Под риском', stateKind: 'warn' as const, value01: 0.5 }
    return { label: 'Критично', stateKind: 'bad' as const, value01: 0.2 }
  }, [scoring])

  const stormStatus = useMemo(() => {
    if (typeof goalState?.pCollapse !== 'number') {
      return { label: '—', stateKind: 'na' as const, value01: null }
    }
    const collapse = goalState.pCollapse
    if (collapse < 0.18) return { label: 'Штиль', stateKind: 'good' as const, value01: 0.84 }
    if (collapse < 0.35) return { label: 'Умеренный', stateKind: 'warn' as const, value01: 0.5 }
    return { label: 'Сильный', stateKind: 'bad' as const, value01: 0.18 }
  }, [goalState?.pCollapse])

  const impulseStatus = useMemo(() => {
    if (historyTrend === 'up') return { label: 'Растёт', stateKind: 'good' as const, value01: 0.8 }
    if (historyTrend === 'down') return { label: 'Падает', stateKind: 'bad' as const, value01: 0.22 }
    return { label: 'Стоит', stateKind: 'warn' as const, value01: 0.5 }
  }, [historyTrend])

  const yggdrasilBranches = useMemo(() => {
    const rowsWithPriority = krProgressRows.map((row) => {
      const weight = selectedWeights[row.kr.metricId] ?? 0
      const runeLevel = Math.max(0, Math.min(5, weightToRuneLevel(weight)))
      return { row, runeLevel }
    })
    const topPriorityBranchId = rowsWithPriority.reduce<{ id: string | null; level: number }>((best, current) => {
      if (current.runeLevel > best.level) {
        return { id: current.row.kr.id, level: current.runeLevel }
      }
      return best
    }, { id: null, level: -1 }).id
    const weakestBranchId = weakestKr?.kr.id ?? null

    return rowsWithPriority.map(({ row, runeLevel }, index) => {
      const label = METRICS.find((item) => item.id === row.kr.metricId)?.labelRu ?? row.kr.metricId
      const normalizedRune = Math.max(1, runeLevel)
      const rune = (['I', 'II', 'III', 'IV', 'V'][normalizedRune - 1] ?? 'I') as 'I' | 'II' | 'III' | 'IV' | 'V'
      const strength: BranchStrength = row.progress < 0.34 ? 'weak' : row.progress < 0.67 ? 'normal' : 'strong'
      const priorityBand: 'low' | 'medium' | 'high' = runeLevel <= 1 ? 'low' : runeLevel <= 3 ? 'medium' : 'high'
      const missionEffectMin = Math.max(2, Math.min(4, runeLevel + 1))
      const missionEffectMax = Math.max(missionEffectMin + 1, Math.min(6, runeLevel + 2))
      const activeMissionForBranch = selected?.activeMission
      const isActiveMissionBranch = Boolean(activeMissionForBranch && activeMissionForBranch.krKey === row.kr.id)

      return {
        id: row.kr.id,
        title: label,
        direction: row.kr.direction,
        rune,
        strength,
        priorityBand,
        isTopPriority: row.kr.id === topPriorityBranchId,
        isWeak: row.kr.id === weakestBranchId,
        missionEffectCores: { min: missionEffectMin, max: missionEffectMax },
        missionEffectExpected: activeMissionForBranch?.expectedDefault ?? Math.round((missionEffectMin + missionEffectMax) / 2),
        missionDayLabel: isActiveMissionBranch && missionProgress ? missionProgress : undefined,
        missions: isActiveMissionBranch && activeMissionForBranch
          ? [{ id: activeMissionForBranch.id, title: activeMissionForBranch.title, done: false }]
          : [],
        index,
      }
    })
  }, [krProgressRows, missionProgress, selected, selectedWeights, weakestKr])


  const editorKeyResults = useMemo(() => {
    if (!editor) return []
    return ensureGoalKeyResults(editor, goalState)
  }, [editor, goalState])

  const updateEditorKr = (krId: string, patch: Partial<GoalKeyResult>) => {
    if (!editor) return
    const nextKrs = editorKeyResults.map((item) => item.id === krId ? { ...item, ...patch } : item)
    setEditor({
      ...editor,
      okr: {
        ...editor.okr,
        keyResults: nextKrs,
      },
    })
  }

  const saveMissionSuggestion = async () => {
    if (!selected || !missionTargetKr || !nextMissionTemplate) return
    const now = Date.now()
    const nextSuggestions = [
      { krKey: missionTargetKr.kr.id, templateId: nextMissionTemplate.id, ts: now },
      ...(selected.missionControl?.lastSuggestions ?? []).filter((item) => !(item.krKey === missionTargetKr.kr.id && item.templateId === nextMissionTemplate.id)),
    ].slice(0, 20)
    await updateGoal(selected.id, {
      missionControl: {
        ...(selected.missionControl ?? {}),
        lastSuggestions: nextSuggestions,
      },
    })
  }

  const rerollMission = async () => {
    if (!selected || !canReroll) return
    const now = Date.now()
    const dayKey = dayKeyFromTs(now)
    const used = selected.missionControl?.rerollDayKey === dayKey ? (selected.missionControl?.rerollsUsed ?? 0) : 0
    await saveMissionSuggestion()
    await updateGoal(selected.id, {
      missionControl: {
        ...(selected.missionControl ?? {}),
        rerollDayKey: dayKey,
        rerollsUsed: Math.min(MISSION_REROLL_LIMIT_PER_DAY, used + 1),
        lastRerollAt: now,
      },
    })
    setMissionSuggestionSalt((value) => value + 1)
    setMissionDetailsOpen(false)
    await reload()
  }

  const acceptMission = async () => {
    if (!selected || !missionTargetKr || activeMission || !nextMissionTemplate || !nextMissionEffect) return
    const now = Date.now()
    await updateGoal(selected.id, {
      activeMission: {
        id: `mission-${now}`,
        goalId: selected.id,
        krKey: missionTargetKr.kr.id,
        templateId: nextMissionTemplate.id,
        title: nextMissionTemplate.title,
        why: nextMissionTemplate.why,
        timeBandMinutes: nextMissionTemplate.timeBandMinutes,
        effectProfile: nextMissionTemplate.effectProfile,
        ifThenPlan: nextMissionTemplate.ifThenPlan,
        durationDays: nextMissionDuration,
        startedAt: now,
        endsAt: now + nextMissionDuration * 24 * 60 * 60 * 1000,
        expectedMin: nextMissionEffect.min,
        expectedMax: nextMissionEffect.max,
        expectedDefault: nextMissionEffect.expected,
      },
      missionControl: {
        ...(selected.missionControl ?? {}),
        lastSuggestions: [
          { krKey: missionTargetKr.kr.id, templateId: nextMissionTemplate.id, ts: now },
          ...((selected.missionControl?.lastSuggestions ?? []).filter((item) => !(item.krKey === missionTargetKr.kr.id && item.templateId === nextMissionTemplate.id))),
        ].slice(0, 20),
      },
    })
    setMissionDetailsOpen(false)
    await reload()
  }

  const replaceMission = async () => {
    if (!selected || !activeMission) return
    if (missionProgressLabel(activeMission.startedAt, activeMission.durationDays) !== 'День 1/3') return
    const skippedItem = {
      id: `mission-skip-${Date.now()}`,
      goalId: selected.id,
      krKey: activeMission.krKey,
      templateId: activeMission.templateId,
      title: `${activeMission.title} (пропущена)`,
      durationDays: activeMission.durationDays,
      completedAt: Date.now(),
      coresAwarded: 0,
    }
    await updateGoal(selected.id, {
      activeMission: undefined,
      missionHistory: [skippedItem, ...(selected.missionHistory ?? [])].slice(0, 10),
    })
    setMissionSuggestionSalt((value) => value + 1)
    await reload()
  }

  const openMissionConfirm = () => {
    if (!activeMission) return
    setMissionAwardDraft(activeMission.expectedDefault)
    setMissionConfirmOpen(true)
  }

  const closeMissionConfirm = () => {
    setMissionConfirmOpen(false)
    requestAnimationFrame(() => missionDoneButtonRef.current?.focus({ preventScroll: true }))
  }

  useEffect(() => {
    if (!missionConfirmOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const focusableSelectors = [
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',')

    const node = missionConfirmDialogRef.current
    const focusable = node ? Array.from(node.querySelectorAll<HTMLElement>(focusableSelectors)) : []
    focusable[0]?.focus({ preventScroll: true })

    const onKeyDown = (event: KeyboardEvent) => {
      if (!missionConfirmOpen) return
      if (event.key === 'Escape') {
        event.preventDefault()
        closeMissionConfirm()
        return
      }
      if (event.key !== 'Tab') return
      const dialogNode = missionConfirmDialogRef.current
      if (!dialogNode) return
      const trapped = Array.from(dialogNode.querySelectorAll<HTMLElement>(focusableSelectors))
      if (trapped.length === 0) return
      const first = trapped[0]
      const last = trapped[trapped.length - 1]
      const active = document.activeElement
      if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus({ preventScroll: true })
      } else if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus({ preventScroll: true })
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [missionConfirmOpen])

  const confirmMissionCompletion = async () => {
    if (!selected || !activeMission) return
    const awarded = Math.max(activeMission.expectedMin, Math.min(activeMission.expectedMax, Math.round(missionAwardDraft)))
    const updatedKrs = selectedKrs.map((kr) => {
      if (kr.id !== activeMission.krKey) return kr
      const current = typeof kr.progress === 'number' ? kr.progress : 0
      const progressBoost = activeMission.durationDays === 1 ? 0.2 : 0.35
      return { ...kr, progressMode: 'manual' as const, progress: clamp01(current + progressBoost) }
    })
    const historyItem = {
      id: `fruit-${Date.now()}`,
      goalId: selected.id,
      krKey: activeMission.krKey,
      templateId: activeMission.templateId,
      title: activeMission.title,
      durationDays: activeMission.durationDays,
      completedAt: Date.now(),
      coresAwarded: awarded,
    }

    await updateGoal(selected.id, {
      okr: { ...selected.okr, keyResults: updatedKrs },
      activeMission: undefined,
      missionHistory: [historyItem, ...(selected.missionHistory ?? [])].slice(0, 10),
    })

    if (scoring) {
      const scoreBoost = activeMission.durationDays === 1 ? 0.35 : 0.7
      await addGoalEvent({ goalId: selected.id, goalScore: scoring.goalScore + scoreBoost, goalGap: scoring.goalGap - scoreBoost })
    }

    closeMissionConfirm()
    await reload()
  }


  const goalProgressMap = useMemo(() => {
    const map = new Map<string, number>()
    goals.forEach((goal) => {
      if (!goalState) return
      const evalResult = evaluateGoalScore(goal, goalState)
      map.set(goal.id, evalResult.goalScore)
    })
    return map
  }, [goals, goalState])

  const groveOptions = useMemo(() => {
    const values = Array.from(new Set(goals
      .filter((goal) => goal.status === forestTab)
      .map((goal) => goal.groveId?.trim() || 'Без рощи')))
    return ['all', ...values]
  }, [forestTab, goals])

  const visibleForestGoals = useMemo(() => {
    const query = forestSearch.trim().toLowerCase()
    return goals
      .filter((goal) => goal.status === forestTab)
      .filter((goal) => forestGroveFilter === 'all' || (goal.groveId?.trim() || 'Без рощи') === forestGroveFilter)
      .filter((goal) => (query ? goal.title.toLowerCase().includes(query) : true))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }, [forestGroveFilter, forestSearch, forestTab, goals])

  const universeStageGoals = useMemo<UniverseStageGoal[]>(() => {
    return visibleForestGoals.map((goal) => {
      const krs = ensureGoalKeyResults(goal, goalState)
      const weakestKrId = krs.reduce<{ id: string | null; progress: number }>((acc, kr) => {
        const progress = typeof kr.progress === 'number' ? kr.progress : 0.5
        if (progress < acc.progress) {
          return { id: kr.id, progress }
        }
        return acc
      }, { id: null, progress: Infinity }).id
      const levers = krs.slice(0, 8).map((kr) => {
        const weight = Math.max(0.05, Math.abs(goal.weights[kr.metricId] ?? 0.2))
        const influence = Math.max(1, Math.round(weight * 10 + (typeof kr.progress === 'number' ? kr.progress * 3 : 1)))
        const label = METRICS.find((item) => item.id === kr.metricId)?.labelRu ?? kr.metricId
        const priorityBand: 'low' | 'medium' | 'high' = weight > 0.66 ? 'high' : weight > 0.33 ? 'medium' : 'low'
        return {
          id: kr.id,
          title: label,
          influence,
          priorityBand,
          isWeak: kr.id === weakestKrId,
          hasActiveMission: goal.activeMission?.krKey === kr.id,
          isMissionWeakSpot: selectedGoalId === goal.id && kr.id === weakestKrId,
        }
      })

      const sizeScore = Math.max(1, levers.reduce((sum, lever) => sum + lever.influence, 0))
      const score = goalProgressMap.get(goal.id) ?? 0.5
      const temperature: 'hot' | 'neutral' | 'cold' = score >= 0.67 ? 'hot' : score <= 0.34 ? 'cold' : 'neutral'
      return {
        id: goal.id,
        title: goal.title,
        objective: goal.okr.objective,
        sizeScore,
        temperature,
        levers,
        missionHud: selectedGoalId === goal.id ? {
          title: goal.activeMission?.title ?? nextMissionTitle,
          costLabel: `${goal.activeMission?.timeBandMinutes ?? nextMissionTemplate?.timeBandMinutes ?? 15} мин`,
        } : undefined,
      }
    })
  }, [goalProgressMap, goalState, nextMissionTemplate?.timeBandMinutes, nextMissionTitle, selectedGoalId, visibleForestGoals])

  const universeStageLinks = useMemo<UniverseStageLink[]>(() => {
    const visibleIds = new Set(universeStageGoals.map((goal) => goal.id))
    return goals.flatMap((goal) => (goal.links ?? [])
      .filter((link) => visibleIds.has(goal.id) && visibleIds.has(link.toGoalId))
      .map((link, index) => ({
        id: `${goal.id}-${link.toGoalId}-${link.type}-${index}`,
        sourceGoalId: goal.id,
        targetGoalId: link.toGoalId,
        type: link.type,
      })))
  }, [goals, universeStageGoals])

  const selectedUniverseGoal = useMemo(() => universeStageGoals.find((goal) => goal.id === selectedGoalId) ?? null, [selectedGoalId, universeStageGoals])
  const selectedUniverseLever = useMemo(() => {
    if (!selectedKrId || !selectedUniverseGoal) return null
    return selectedUniverseGoal.levers.find((lever) => lever.id === selectedKrId) ?? null
  }, [selectedKrId, selectedUniverseGoal])


  const activeRoots = useMemo(() => goals.filter((goal) => goal.status === 'active' && !goal.parentGoalId), [goals])

  const archiveGoal = async (goal: GoalRecord) => {
    await updateGoal(goal.id, { status: 'archived', active: false })
    await reload()
  }

  const trashGoal = async (goal: GoalRecord) => {
    await updateGoal(goal.id, { status: 'trashed', active: false, trashedAt: new Date().toISOString() })
    await reload()
  }

  const restoreGoal = async (goal: GoalRecord) => {
    await updateGoal(goal.id, { status: 'active', trashedAt: undefined })
    await reload()
  }

  const deleteForever = async (goal: GoalRecord) => {
    if (!window.confirm(`Удалить цель «${goal.title}» навсегда?`)) return
    const { db } = await import('../core/storage/db')
    await db.goals.delete(goal.id)
    await reload()
  }

  const renameGoal = async (goal: GoalRecord) => {
    const next = window.prompt('Новое имя цели', goal.title)?.trim()
    if (!next) return
    await updateGoal(goal.id, { title: next })
    await reload()
  }

  const assignGrove = async (goal: GoalRecord) => {
    const next = window.prompt('Название рощи (пусто = Без рощи)', goal.groveId ?? '')
    if (next == null) return
    await updateGoal(goal.id, { groveId: next.trim() || undefined })
    await reload()
  }

  const moveToSuperGoal = async (goal: GoalRecord) => {
    const options = activeRoots.filter((item) => item.id !== goal.id)
    const defaultValue = goal.parentGoalId ?? ''
    const selectedParentId = window.prompt(`ID супер-цели (пусто = убрать):\n${options.map((item) => `${item.id}: ${item.title}`).join('\n')}`, defaultValue)
    if (selectedParentId == null) return
    await updateGoal(goal.id, { parentGoalId: selectedParentId.trim() || undefined })
    await reload()
  }

  const closeForestMenu = useCallback((options?: { restoreFocus?: boolean }) => {
    const restoreFocus = options?.restoreFocus ?? false
    const goalId = forestMenuGoalId
    setForestMenuGoalId(null)
    setForestMenuStyle(null)
    if (restoreFocus && goalId) {
      requestAnimationFrame(() => {
        forestMenuTriggerRefs.current[goalId]?.focus({ preventScroll: true })
      })
    }
  }, [forestMenuGoalId])

  const computeForestMenuStyle = (goalId: string): CSSProperties | null => {
    const trigger = forestMenuTriggerRefs.current[goalId]
    if (!trigger) return null
    const rect = trigger.getBoundingClientRect()
    const menuWidth = 240
    const menuHeight = 320
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const gutter = 8

    let left = rect.right - menuWidth
    if (left < gutter) {
      left = Math.min(rect.left, viewportWidth - menuWidth - gutter)
    }
    left = Math.max(gutter, Math.min(left, viewportWidth - menuWidth - gutter))

    let top = rect.bottom + 4
    if (top + menuHeight > viewportHeight - gutter) {
      top = rect.top - menuHeight - 4
    }
    top = Math.max(gutter, Math.min(top, viewportHeight - menuHeight - gutter))

    return {
      position: 'fixed',
      top,
      left,
      minWidth: `${menuWidth}px`,
      zIndex: 1200,
    }
  }

  useEffect(() => {
    if (!forestMenuGoalId) return
    const updatePosition = () => {
      setForestMenuStyle(computeForestMenuStyle(forestMenuGoalId))
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [forestMenuGoalId])

  useEffect(() => {
    if (!forestMenuGoalId) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      const activeTrigger = forestMenuTriggerRefs.current[forestMenuGoalId]
      const menuElement = document.getElementById(`forest-menu-${forestMenuGoalId}`)
      if (activeTrigger?.contains(target) || menuElement?.contains(target)) return
      closeForestMenu()
    }
    const onForestScroll = () => {
      closeForestMenu()
    }
    document.addEventListener('pointerdown', onPointerDown)
    const forestList = forestListRef.current
    forestList?.addEventListener('scroll', onForestScroll)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      forestList?.removeEventListener('scroll', onForestScroll)
    }
  }, [closeForestMenu, forestMenuGoalId])

  useEffect(() => {
    if (!forestMenuGoalId) return
    const timer = window.setTimeout(() => {
      const firstEnabledItem = forestMenuItemRefs.current.find((item) => item && !item.disabled)
      firstEnabledItem?.focus({ preventScroll: true })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [forestMenuGoalId])

  const openLinkModal = () => {
    if (!selected) return
    setLinkSearch('')
    setLinkTargetId('')
    setLinkTypeDraft('supports')
    setLinkModalOpen(true)
  }

  const addGoalLink = async () => {
    if (!selected || !linkTargetId || linkTargetId === selected.id) return
    const existing = selected.links ?? []
    if (existing.some((item) => item.toGoalId === linkTargetId && item.type === linkTypeDraft)) return
    await updateGoal(selected.id, { links: [...existing, { toGoalId: linkTargetId, type: linkTypeDraft }] })
    setLinkModalOpen(false)
    await reload()
  }

  const removeGoalLink = async (toGoalId: string, type: GoalLinkType) => {
    if (!selected) return
    const next = (selected.links ?? []).filter((item) => !(item.toGoalId === toGoalId && item.type === type))
    await updateGoal(selected.id, { links: next })
    await reload()
  }

  const confirmAutoSuggestion = async (targetGoalId: string) => {
    if (!selected) return
    const suggestedType = suggestionTypeDraftByGoalId[targetGoalId] ?? 'supports'
    const existing = selected.links ?? []
    if (existing.some((item) => item.toGoalId === targetGoalId && item.type === suggestedType)) return
    await updateGoal(selected.id, { links: [...existing, { toGoalId: targetGoalId, type: suggestedType }] })
    setHiddenAutoSuggestionKeys((current) => ({ ...current, [`${selected.id}->${targetGoalId}`]: true }))
    await reload()
  }

  const hideAutoSuggestion = (targetGoalId: string) => {
    if (!selected) return
    setHiddenAutoSuggestionKeys((current) => ({ ...current, [`${selected.id}->${targetGoalId}`]: true }))
  }

  const closeSubmenu = useCallback(() => {
    if (!submenuOpen) return
    const trigger = submenuTriggerRefs.current[submenuOpen]
    setSubmenuOpen(null)
    trigger?.focus({ preventScroll: true })
  }, [submenuOpen])


  useEffect(() => {
    if (typeof window === 'undefined' || import.meta.env.PROD) return
    if (!window.location.pathname.includes('/goals')) return
    const holder = document.querySelector('.goals-page')
    if (!holder) return
    const text = holder.textContent ?? ''
    const latinChunks = text.match(/[A-Za-z]{3,}/g) ?? []
    const allowed = new Set(['id', 'KR'])
    const violations = latinChunks.filter((item) => !allowed.has(item))
    if (violations.length > 0) {
      console.warn('[Goals RU-only] Найдена латиница:', Array.from(new Set(violations)).slice(0, 12))
    }
  })

  useEffect(() => {
    if (!submenuOpen) return
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      const activeTrigger = submenuTriggerRefs.current[submenuOpen]
      if (submenuPopoverRef.current?.contains(target)) return
      if (activeTrigger?.contains(target)) return
      setSubmenuOpen(null)
    }
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeSubmenu()
    }
    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onEscape)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onEscape)
    }
  }, [closeSubmenu, submenuOpen])

  void [
    linkTypeLabels,
    setNextMissionDuration,
    missionDetailsOpen,
    supportsExpanded,
    setSuggestionTypeDraftByGoalId,
    setHiddenConflictDayKeyByGoal,
    selectedLinkedTargets,
    supportsLinkedGoals,
    autoLinkSuggestions,
    treeState,
    isConflictHiddenToday,
    missionHistory,
    rerollMission,
    acceptMission,
    replaceMission,
    openMissionConfirm,
    selectedUniverseLever,
    openLinkModal,
    removeGoalLink,
    confirmAutoSuggestion,
    hideAutoSuggestion,
  ]

  return (
    <section className="goals-page goals-surface">
      <div className="goals-surface__submenu" role="menubar" aria-label="Подменю целей">
        {([
          ['search', goalsCopyRu.submenu.search],
          ['filter', goalsCopyRu.submenu.filters],
          ['roots', goalsCopyRu.submenu.roots],
          ['forge', goalsCopyRu.submenu.forge],
        ] as const).map(([id, label]) => {
          const isOpen = submenuOpen === id
          return (
            <div key={id} className="goals-surface__submenu-item">
              <button
                ref={(node) => { submenuTriggerRefs.current[id] = node }}
                type="button"
                className={isOpen ? 'goals-surface__submenu-trigger goals-surface__submenu-trigger--active' : 'goals-surface__submenu-trigger'}
                aria-haspopup="menu"
                aria-expanded={isOpen}
                onClick={() => setSubmenuOpen((value) => value === id ? null : id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    setSubmenuOpen(id)
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    closeSubmenu()
                  }
                }}
              >
                {label}{id === 'roots' ? <span className="goals-surface__submenu-muted">{rootsStageEnabled ? 'ВКЛ' : 'ВЫКЛ'}</span> : null}
              </button>
              {isOpen ? (
                <div ref={(node) => { submenuPopoverRef.current = node }} className="goals-surface__submenu-popover" role="menu">
                  {id === 'roots' ? (
                    <div className="goals-surface__submenu-roots">
                      <p>Показывать на сцене связи только от выбранной цели.</p>
                      <button type="button" className={rootsStageEnabled ? 'filter-button filter-button--active' : 'filter-button'} onClick={() => setRootsStageEnabled((value) => !value)}>
                        Корни: {rootsStageEnabled ? 'ВКЛ' : 'ВЫКЛ'}
                      </button>
                    </div>
) : id === 'search' ? <p>Поиск доступен в навигаторе слева.</p> : id === 'filter' ? <p>Фильтры доступны в навигаторе слева.</p> : <p>Кузница открывается для выбранной цели.</p>}
                  {id === 'forge' ? <button ref={seedButtonRef} type="button" onClick={startSeed}>Посадить семя</button> : null}
                  {id === 'forge' ? <button type="button" onClick={() => {
                    if (!selected) return
                    const focus = Object.entries(selectedWeights).sort((a, b) => Math.abs((b[1] ?? 0)) - Math.abs((a[1] ?? 0))).slice(0, 3)
                    const impulses = Object.fromEntries(focus.map(([metricId, w]) => [metricId, (w ?? 0) > 0 ? 0.5 : -0.5]))
                    window.localStorage.setItem('gamno.multiverseDraft', JSON.stringify({
                      impulses,
                      focusMetrics: focus.map(([metricId]) => metricId),
                      sourceLabelRu: 'Цель+миссия → Мультивселенная',
                      activeGoal: { id: selected.id, title: selected.title, objective: selected.okr.objective },
                      activeMission: selected.activeMission,
                    }))
                    navigate('/multiverse')
                  }}>Открыть в Мультивселенной</button> : null}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>

      <div className="goals-surface__body">
        <article className="goals-surface__left goals-pane goals-forest">
          <div className="goals-surface__section-head"><h2>{goalsCopyRu.left.title}</h2></div>
          <div className="goals-surface__seed-actions">
            <button type="button" className="ghost-button" onClick={startSeed}>{goalsCopyRu.left.addGoal}</button>
          </div>
          <div className="goals-nav-filters">
            <div className="settings-actions">
              {(['active', 'archived', 'trashed'] as ForestTab[]).map((tab) => (
                <button key={tab} type="button" className={forestTab === tab ? 'filter-button filter-button--active' : 'filter-button'} onClick={() => setForestTab(tab)}>{forestTabLabels[tab]}</button>
              ))}
            </div>
            <label>
              Роща
              <select value={forestGroveFilter} onChange={(event) => setForestGroveFilter(event.target.value)}>
                {groveOptions.map((grove) => <option key={grove} value={grove}>{grove === 'all' ? 'Все рощи' : grove}</option>)}
              </select>
            </label>
            <label>
              Поиск
              <input value={forestSearch} onChange={(event) => setForestSearch(event.target.value)} placeholder={goalsCopyRu.left.searchPlaceholder} />
            </label>
          </div>
          <div className="goals-forest__list" ref={forestListRef}>
            {visibleForestGoals.length === 0 ? (
              <div className="goals-pane__empty goals-pane__empty--compact">
                <p>{goalsCopyRu.left.noGoals}</p>
                <button type="button" className="ghost-button" onClick={startSeed}>{goalsCopyRu.left.addGoal}</button>
              </div>
            ) : (
              <ul>
                {visibleForestGoals.map((goal) => (
                  <li key={goal.id}>
                    <div className={selectedGoalId === goal.id ? 'goals-forest__goal-row goals-forest__goal-row--selected' : 'goals-forest__goal-row'}>
                      <button
                        type="button"
                        className={selectedGoalId === goal.id ? 'filter-button filter-button--active' : 'filter-button'}
                        onClick={() => {
                          setSelectedGoalId(goal.id)
                          setEditor(goal)
                        }}
                      >
                        {goal.title}
                      </button>
                      <div className="goals-forest__badges" aria-label="Метки цели">
                        <span className="chip">{goalStatusBadgeLabel[goal.status]}</span>
                        {goal.activeMission ? <span className="chip">{goalsCopyRu.cockpit.missionInWork}</span> : <span className="chip">{goalsCopyRu.cockpit.missionHasStep}</span>}
                      </div>
                      <div className="goals-forest__menu-wrap">
                        <button
                          type="button"
                          className="filter-button"
                          aria-haspopup="menu"
                          aria-expanded={forestMenuGoalId === goal.id}
                          aria-controls={forestMenuGoalId === goal.id ? `forest-menu-${goal.id}` : undefined}
                          onClick={(event) => {
                            const button = event.currentTarget
                            const rect = button.getBoundingClientRect()
                            setForestMenuStyle({ top: rect.bottom + window.scrollY + 6, left: rect.right + window.scrollX - 180 })
                            setForestMenuGoalId((prev) => {
                              if (prev === goal.id) {
                                setForestMenuStyle(null)
                                return null
                              }
                              return goal.id
                            })
                          }}
                        >
                          ⋯
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {forestMenuGoalId && forestMenuStyle ? createPortal((() => {
            const menuGoal = goals.find((item) => item.id === forestMenuGoalId)
            if (!menuGoal) return null
            const menuItems: Array<{
              key: string
              label: string
              action: () => Promise<void> | void
              disabled?: boolean
              danger?: boolean
            }> = [
              {
                key: 'open',
                label: 'Открыть',
                action: () => {
                  setSelectedGoalId(menuGoal.id)
                  setEditor(menuGoal)
                },
              },
              {
                key: 'activate',
                label: 'Сделать активной',
                action: async () => {
                  await setActiveGoal(menuGoal.id)
                  await reload()
                },
                disabled: menuGoal.status !== 'active',
              },
              {
                key: 'grove',
                label: 'Назначить рощу',
                action: () => assignGrove(menuGoal),
              },
              {
                key: 'super-goal',
                label: menuGoal.parentGoalId ? 'Убрать из супер-цели' : 'В супер-цель',
                action: () => moveToSuperGoal(menuGoal),
              },
              {
                key: 'rename',
                label: 'Переименовать',
                action: () => renameGoal(menuGoal),
              },
              ...(menuGoal.status === 'active' ? [{
                key: 'archive',
                label: 'Архивировать',
                action: () => archiveGoal(menuGoal),
              }] : []),
              ...(menuGoal.status !== 'trashed' ? [{
                key: 'trash',
                label: 'В корзину',
                action: () => trashGoal(menuGoal),
              }] : []),
              ...(menuGoal.status !== 'active' ? [{
                key: 'restore',
                label: 'Восстановить',
                action: () => restoreGoal(menuGoal),
              }] : []),
              ...(menuGoal.status === 'trashed' ? [{
                key: 'delete-forever',
                label: 'Удалить навсегда',
                danger: true,
                action: () => deleteForever(menuGoal),
              }] : []),
            ]
            const sections: string[][] = [
              ['open', 'activate'],
              ['grove', 'super-goal', 'rename'],
              ['archive', 'trash', 'restore'],
              ['delete-forever'],
            ]
            const keyToItem = new Map(menuItems.map((item) => [item.key, item]))
            const sectionItems = sections
              .map((section) => section.map((key) => keyToItem.get(key)).filter(Boolean) as typeof menuItems)
              .filter((section) => section.length > 0)
            const flatItems = sectionItems.flat()
            forestMenuItemRefs.current = []

            const moveFocus = (direction: 1 | -1, fromIndex: number) => {
              for (let offset = 1; offset <= flatItems.length; offset += 1) {
                const nextIndex = (fromIndex + direction * offset + flatItems.length) % flatItems.length
                const candidate = forestMenuItemRefs.current[nextIndex]
                if (candidate && !candidate.disabled) {
                  candidate.focus({ preventScroll: true })
                  return
                }
              }
            }

            const focusBoundary = (target: 'first' | 'last') => {
              const ordered = target === 'first' ? forestMenuItemRefs.current : [...forestMenuItemRefs.current].reverse()
              const nextItem = ordered.find((item) => item && !item.disabled)
              nextItem?.focus({ preventScroll: true })
            }

            return (
              <div
                id={`forest-menu-${menuGoal.id}`}
                className="goals-forest__menu"
                style={forestMenuStyle}
                role="menu"
                aria-label={`Действия для цели ${menuGoal.title}`}
              >
                {sectionItems.map((section, sectionIndex) => (
                  <div key={`section-${sectionIndex}`} className="goals-forest__menu-section" role="none">
                    {section.map((item) => {
                      const itemIndex = flatItems.findIndex((row) => row.key === item.key)
                      return (
                        <button
                          key={item.key}
                          type="button"
                          role="menuitem"
                          tabIndex={-1}
                          disabled={item.disabled}
                          className={item.danger ? 'goals-forest__menu-item goals-forest__menu-item--danger' : 'goals-forest__menu-item'}
                          ref={(node) => {
                            forestMenuItemRefs.current[itemIndex] = node
                          }}
                          onKeyDown={async (event) => {
                            if (event.key === 'ArrowDown') {
                              event.preventDefault()
                              moveFocus(1, itemIndex)
                            } else if (event.key === 'ArrowUp') {
                              event.preventDefault()
                              moveFocus(-1, itemIndex)
                            } else if (event.key === 'Home') {
                              event.preventDefault()
                              focusBoundary('first')
                            } else if (event.key === 'End') {
                              event.preventDefault()
                              focusBoundary('last')
                            } else if (event.key === 'Escape') {
                              event.preventDefault()
                              closeForestMenu({ restoreFocus: true })
                            } else if (event.key === 'Tab') {
                              closeForestMenu()
                            } else if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              if (!item.disabled) {
                                await item.action()
                                closeForestMenu({ restoreFocus: true })
                              }
                            }
                          }}
                          onClick={async () => {
                            if (item.disabled) return
                            await item.action()
                            closeForestMenu({ restoreFocus: true })
                          }}
                        >
                          {item.label}
                        </button>
                      )
                    })}
                  </div>
                ))}
              </div>
            )
          })(), document.body) : null}
        </article>

        <article className="goals-surface__stage goals-pane">
          <>
            {goalsStageMode === 'cells' ? (
              <GoalCellsStage
                goals={universeStageGoals}
                goalsLoaded={goalsLoaded}
                links={universeStageLinks}
                showLinks={rootsStageEnabled && Boolean(selectedGoalId)}
                selectedGoalId={selectedGoalId}
                selectedBranchId={selectedKrId}
                onSelectGoal={(goalId) => {
                  setSelectedGoalId(goalId)
                              }}
                onSelectBranch={setSelectedKrId}
                onClearBranch={() => setSelectedKrId(null)}
                resetSignal={stageResetSignal}
                tooFewGoalsHint={forestTab === 'active' && universeStageGoals.length < 3 ? 'Добавьте ещё цели.' : null}
                overlayLabel={goalsCopyRu.stage.hint}
                resetLabel={goalsCopyRu.stage.resetView}
                focusLabel={goalsCopyRu.stage.focus}
                onMissionHudClick={focusCockpitMission}
              />
            ) : selected ? (
              <GoalYggdrasilTree
                objective={selected.okr.objective}
                branches={yggdrasilBranches}
                selectedBranchId={selectedKrId}
                onSelectBranch={setSelectedKrId}
                resetSignal={stageResetSignal}
              />
            ) : (
              <div className="goals-pane__empty goals-pane__empty--stage">
                <p><strong>Выберите цель, чтобы увидеть дерево.</strong></p>
                <div className="goals-surface__seed-actions">
                <button type="button" onClick={startSeed}>Посадить семя</button>
                {devUnlocked ? <button type="button" onClick={() => { void seedUniverse() }}>Засеять демо (×7)</button> : null}
              </div>
              </div>
            )}
            {selected && goals.some((item) => item.parentGoalId === selected.id && item.status === 'active') ? (
              <section className="goals-stage-children">
                <h3>Дочерние деревья супер-цели</h3>
                <ul>
                  {goals.filter((item) => item.parentGoalId === selected.id && item.status === 'active').map((child) => <li key={child.id}>{child.title}</li>)}
                </ul>
              </section>
            ) : null}
          </>

          <p className="goals-stage-legend">Размер = влияние · Контур = приоритет · Трещина = слабая · Плод = активная миссия</p>

          <section className="goals-stage-krs">
            <h3>Ключевые ветви</h3>
            {selectedKrs.length === 0 ? <p>Ветви появятся после выбора цели.</p> : null}
            <ul>
              {selectedKrs.slice(0, 5).map((kr) => (
                <li key={kr.id} className={selectedKrId === kr.id ? 'goals-stage-krs__item goals-stage-krs__item--selected' : 'goals-stage-krs__item'}>
                  <strong>{METRICS.find((item) => item.id === kr.metricId)?.labelRu ?? kr.metricId}</strong>
                  <span>{kr.direction === 'up' ? 'Фокус на росте' : 'Фокус на снижении'}</span>
                </li>
              ))}
            </ul>
          </section>
        </article>

        <article className="goals-surface__cockpit goals-pane goals-tree-state">
          <section className="goals-surface__cockpit-floor goals-surface__cockpit-floor--summary">
            <h2>{goalsCopyRu.cockpit.summary}</h2>
            <div className="goals-druid-gauges" aria-label="Состояние">
              <DruidGauge label="Здоровье" value01={trunkHealth.value01} stateLabel={trunkHealth.label} stateKind={trunkHealth.stateKind} />
              <DruidGauge label="Шторм" value01={stormStatus.value01} stateLabel={stormStatus.label} stateKind={stormStatus.stateKind} />
              <DruidGauge label="Импульс" value01={impulseStatus.value01} stateLabel={impulseStatus.label} stateKind={impulseStatus.stateKind} />
            </div>
            <p className="goals-pane__hint"><strong>{goalsCopyRu.cockpit.warnings}:</strong> {conflictLinkedGoals.length > 0 ? `конфликты: ${conflictLinkedGoals.length}` : 'критичных конфликтов нет'}{dependsLinkedGoals.length > 0 ? ` · зависимостей: ${dependsLinkedGoals.length}` : ''}</p>
          </section>
          <section className={cockpitMissionFlash ? 'goals-surface__cockpit-floor goals-surface__cockpit-floor--inspector goals-cockpit-next-step--flash' : 'goals-surface__cockpit-floor goals-surface__cockpit-floor--inspector'}>
            <h2>{goalsCopyRu.cockpit.selectedGoal}</h2>
            {selected ? (
              <div className="goals-cockpit-next-step">
                <p><strong>{goalsCopyRu.cockpit.weakSpot}:</strong> {weakestKr ? METRICS.find((item) => item.id === weakestKr.kr.metricId)?.labelRu ?? weakestKr.kr.metricId : 'не определено'}</p>
                <div className="summary-card goals-cockpit-next-step__card">
                  <h3>{goalsCopyRu.cockpit.nextStep}</h3>
                  <p><strong>{activeMission?.title ?? nextMissionTitle}</strong></p>
                  <p className="goals-pane__hint">{goalsCopyRu.cockpit.missionEffect}: {activeMission ? `${activeMission.expectedMin}…${activeMission.expectedMax} ед.` : nextMissionEffect ? `${nextMissionEffect.min}…${nextMissionEffect.max} ед.` : 'уточняется'}</p>
                  <p className="goals-pane__hint">{goalsCopyRu.cockpit.missionCost}: {activeMission?.timeBandMinutes ?? nextMissionTemplate?.timeBandMinutes ?? 15} мин.</p>
                  <div className="settings-actions">
                    {!activeMission ? <button type="button" onClick={async () => { await acceptMission() }}>{goalsCopyRu.cockpit.missionAccept}</button> : null}
                    <button type="button" className="ghost-button" onClick={async () => { await rerollMission() }}>{goalsCopyRu.cockpit.missionDefer}</button>
                    {activeMission ? <button type="button" ref={missionDoneButtonRef} onClick={openMissionConfirm}>{goalsCopyRu.cockpit.missionDone}</button> : null}
                  </div>
                  <button type="button" className="ghost-button" onClick={() => setMissionDetailsOpen((value) => !value)}>{goalsCopyRu.cockpit.missionWhyToggle}</button>
                  {missionDetailsOpen ? <p className="goals-pane__hint"><strong>{goalsCopyRu.cockpit.whyNow}:</strong> {nextMissionTemplate?.why ?? 'Чтобы удержать траекторию выбранной цели.'}</p> : null}
                </div>
              </div>
            ) : (
              <p className="goals-pane__hint">{goalsCopyRu.cockpit.selectHint}</p>
            )}
          </section>
        </article>
      </div>


      {editor ? (
        <ForgeSheet open={isForgeOpen} onClose={closeForge} title="Кузница: настройка режима">
          <header className="forge-sheet__header">
            <div>
              <p className="forge-sheet__eyebrow">Кузница режимов</p>
              <h2>Кузница</h2>
            </div>
            <button type="button" onClick={closeForge} aria-label="Закрыть кузницу">✕</button>
          </header>

          <section className="forge-sheet__section">
            <h3>Режим</h3>
            <PresetSelector
              presets={modePresets.map((preset) => ({ id: preset.id, title: preset.title }))}
              activePresetId={(selected?.modePresetId ?? 'balance') as GoalModePresetId}
              onSelect={(presetId) => { void applyModePreset(presetId) }}
            />
          </section>

          <section className="forge-sheet__section">
            <div className="forge-sheet__section-head">
              <h3>Руны</h3>
              <div className="forge-sheet__actions-row">
                <label className="goals-debug-toggle">
                  <input type="checkbox" checked={selected?.isManualTuning ?? false} onChange={() => { void toggleManualTuning() }} />
                  Ручной режим
                </label>
                {selected?.isManualTuning ? (
                  <button type="button" className="ghost-button" onClick={() => { void resetManualToPreset() }}>
                    Сбросить к пресету
                  </button>
                ) : null}
              </div>
            </div>
            <div className="forge-runes-grid">
              {forgeRunes.map((rune) => (
                <RuneDial
                  key={rune.metricId}
                  label={rune.label}
                  level={rune.level}
                  stateLabel={runeStateLabels[rune.level]}
                  onChange={(level) => { void applyRuneLevel(rune.metricId, level) }}
                />
              ))}
            </div>
          </section>

          <ForgePreview
            coresMin={forgePreview.coresMin}
            coresMax={forgePreview.coresMax}
            weather={forgePreview.weather}
            risk={forgePreview.risk}
          />

          {selected?.isManualTuning ? (
            <AdvancedTuning
              keyResults={editorKeyResults}
              showDebugNumbers={showDebugNumbers}
              onToggleDebugNumbers={setShowDebugNumbers}
              onUpdateKr={updateEditorKr}
            />
          ) : null}

          <article className="summary-card panel forge-sheet__editor">
            <h3>Параметры цели</h3>
            <label>Название<input value={editor.title} onChange={(e) => setEditor({ ...editor, title: e.target.value })} /></label>
            <label>Цель<input value={editor.okr.objective} onChange={(e) => setEditor({ ...editor, okr: { ...editor.okr, objective: e.target.value } })} /></label>
            <label>Описание<textarea value={editor.description ?? ''} onChange={(e) => setEditor({ ...editor, description: e.target.value })} /></label>
            <label>
              Горизонт
              <select value={editor.horizonDays} onChange={(e) => setEditor({ ...editor, horizonDays: Number(e.target.value) as 7 | 14 | 30 })}>
                <option value={7}>7 дней</option><option value={14}>14 дней</option><option value={30}>30 дней</option>
              </select>
            </label>
            <div className="settings-actions">
              <button type="button" onClick={async () => { await updateGoal(editor.id, editor); await reload() }}>Сохранить</button>
              <button type="button" onClick={async () => { await setActiveGoal(editor.id); await reload() }}>Сделать активной</button>
              <button type="button" onClick={async () => { await updateGoal(editor.id, { status: 'archived', active: false }); await reload() }}>Архивировать</button>
            </div>
          </article>
        </ForgeSheet>
      ) : null}


      {linkModalOpen ? (
        <div className="goals-modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setLinkModalOpen(false) }}>
          <div className="panel goals-modal" role="dialog" aria-modal="true" aria-label="Добавить связь">
            <h2>Добавить связь</h2>
            <label>
              Поиск цели
              <input value={linkSearch} onChange={(event) => setLinkSearch(event.target.value)} placeholder="Найти цель" />
            </label>
            <label>
              Тип связи
              <select value={linkTypeDraft} onChange={(event) => setLinkTypeDraft(event.target.value as GoalLinkType)}>
                <option value="supports">Помогает</option>
                <option value="depends_on">Зависит от</option>
                <option value="conflicts">Конфликтует</option>
              </select>
            </label>
            <label>
              Цель
              <select value={linkTargetId} onChange={(event) => setLinkTargetId(event.target.value)}>
                <option value="">Выберите цель</option>
                {linkCandidates.map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}
              </select>
            </label>
            <div className="settings-actions">
              <button type="button" onClick={async () => { await addGoalLink() }} disabled={!linkTargetId}>Сохранить</button>
              <button type="button" onClick={() => setLinkModalOpen(false)}>Отмена</button>
            </div>
          </div>
        </div>
      ) : null}

      {missionConfirmOpen && activeMission ? (
        <div className="goals-modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) closeMissionConfirm() }}>
          <div ref={missionConfirmDialogRef} className="panel goals-modal" role="dialog" aria-modal="true" aria-label="Подтвердить выполнение миссии">
            <h2>Сколько ядер реально дал этот квест?</h2>
            <label>
              Ядра эффекта
              <input
                type="range"
                min={activeMission.expectedMin}
                max={activeMission.expectedMax}
                step={1}
                value={missionAwardDraft}
                onChange={(event) => setMissionAwardDraft(Number(event.target.value))}
              />
            </label>
            <p><strong>{missionAwardDraft}</strong> ядер (доступно {activeMission.expectedMin}…{activeMission.expectedMax})</p>
            <div className="settings-actions">
              <button type="button" onClick={async () => { await confirmMissionCompletion() }}>Подтвердить</button>
              <button type="button" onClick={closeMissionConfirm}>Отмена</button>
            </div>
          </div>
        </div>
      ) : null}

      {seedModalOpen ? (
        <div className="goals-modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) closeSeedModal() }}>
          <div ref={seedDialogRef} className="panel goals-modal" role="dialog" aria-modal="true" aria-label="Посадить семя">
            <h2>Посадить семя</h2>
            <label>Шаблон
              <select value={seedTemplate} onChange={(e) => setSeedTemplate(e.target.value as GoalTemplateId)}>
                {Object.entries(templates).map(([id, item]) => <option key={id} value={id}>{item.title}</option>)}
              </select>
            </label>
            <label>Название<input value={seedTitle} onChange={(e) => setSeedTitle(e.target.value)} /></label>
            <label>Горизонт
              <select value={seedHorizon} onChange={(e) => setSeedHorizon(Number(e.target.value) as 7 | 14 | 30)}>
                <option value={7}>7 дней</option><option value={14}>14 дней</option><option value={30}>30 дней</option>
              </select>
            </label>
            {duplicateCandidate ? (
              <div>
                <p>Похожая цель уже есть среди активных: открыть её?</p>
                <div className="settings-actions">
                  <button type="button" onClick={() => { setSelectedGoalId(duplicateCandidate.id); setEditor(duplicateCandidate); closeSeedModal() }}>Открыть</button>
                  <button type="button" onClick={async () => { await submitSeed(true) }}>Всё равно создать</button>
                </div>
              </div>
            ) : null}
            <div className="settings-actions">
              <button type="button" onClick={async () => { await submitSeed() }}>Создать</button>
              <button type="button" onClick={closeSeedModal}>Отмена</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
