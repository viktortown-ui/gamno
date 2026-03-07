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
type ForestSort = 'recent' | 'progress' | 'preset'

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
  const [forestSort, setForestSort] = useState<ForestSort>('recent')
  const [forestViewMode, setForestViewMode] = useState<'forest' | 'roots'>('forest')
  const [rootsStageEnabled, setRootsStageEnabled] = useState(false)
  const [forestMenuGoalId, setForestMenuGoalId] = useState<string | null>(null)
  const [forestMenuStyle, setForestMenuStyle] = useState<CSSProperties | null>(null)
  const forestMenuTriggerRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const forestMenuItemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const forestListRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    setForestMenuGoalId(null)
    setForestMenuStyle(null)
  }, [forestTab, forestViewMode, goals])

  const [linkModalOpen, setLinkModalOpen] = useState(false)
  const [linkSearch, setLinkSearch] = useState('')
  const [linkTargetId, setLinkTargetId] = useState('')
  const [linkTypeDraft, setLinkTypeDraft] = useState<GoalLinkType>('supports')
  const [isForgeOpen, setIsForgeOpen] = useState(false)
  const [showDebugNumbers, setShowDebugNumbers] = useState(false)
  const [devUnlocked, setDevUnlocked] = useState(false)
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
  const forgeOpenButtonRef = useRef<HTMLButtonElement | null>(null)
  const [nextMissionDuration, setNextMissionDuration] = useState<1 | 3>(3)
  const [missionSuggestionSalt, setMissionSuggestionSalt] = useState(0)
  const [missionDetailsOpen, setMissionDetailsOpen] = useState(false)
  const [missionConfirmOpen, setMissionConfirmOpen] = useState(false)
  const [missionAwardDraft, setMissionAwardDraft] = useState(5)
  const [submenuOpen, setSubmenuOpen] = useState<'search' | 'sort' | 'filter' | 'roots' | 'autolinks' | 'forge' | null>(null)
  const submenuTriggerRefs = useRef<Record<'search' | 'sort' | 'filter' | 'roots' | 'autolinks' | 'forge', HTMLButtonElement | null>>({
    search: null,
    sort: null,
    filter: null,
    roots: null,
    autolinks: null,
    forge: null,
  })
  const submenuPopoverRef = useRef<HTMLDivElement | null>(null)
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false)
  const [supportsExpanded, setSupportsExpanded] = useState(false)
  const [showAutoLinkSuggestions, setShowAutoLinkSuggestions] = useState(false)
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

  useEffect(() => {
    setShowAutoLinkSuggestions(false)
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
    setForestViewMode('forest')
    await reload()
  }

  const closeSeedModal = () => {
    setSeedModalOpen(false)
    setDuplicateCandidate(null)
    requestAnimationFrame(() => seedButtonRef.current?.focus())
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
    focusable[0]?.focus()

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
        first.focus()
      } else if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
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
    requestAnimationFrame(() => forgeOpenButtonRef.current?.focus())
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
    requestAnimationFrame(() => missionDoneButtonRef.current?.focus())
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
    focusable[0]?.focus()

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
        first.focus()
      } else if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
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

  const visibleForestGoals = useMemo(() => {
    const query = forestSearch.trim().toLowerCase()
    return goals
      .filter((goal) => goal.status === forestTab)
      .filter((goal) => (query ? goal.title.toLowerCase().includes(query) : true))
      .sort((a, b) => {
        if (forestSort === 'progress') {
          return (goalProgressMap.get(b.id) ?? -Infinity) - (goalProgressMap.get(a.id) ?? -Infinity)
        }
        if (forestSort === 'preset') {
          return String(a.modePresetId ?? '').localeCompare(String(b.modePresetId ?? ''), 'ru')
        }
        return b.updatedAt - a.updatedAt
      })
  }, [forestSearch, forestSort, forestTab, goalProgressMap, goals])

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
      }
    })
  }, [goalProgressMap, goalState, visibleForestGoals])

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


  const groves = useMemo(() => {
    const map = new Map<string, GoalRecord[]>()
    visibleForestGoals.forEach((goal) => {
      const key = goal.groveId?.trim() || 'Без рощи'
      map.set(key, [...(map.get(key) ?? []), goal])
    })
    return [['Все рощи', visibleForestGoals], ...Array.from(map.entries())] as Array<[string, GoalRecord[]]>
  }, [visibleForestGoals])

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
        forestMenuTriggerRefs.current[goalId]?.focus()
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
      firstEnabledItem?.focus()
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
    trigger?.focus()
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

  return (
    <section className="goals-page goals-surface">
      <div className="goals-surface__submenu" role="menubar" aria-label="Подменю целей">
        {([
          ['search', 'Поиск'],
          ['sort', 'Сортировка'],
          ['filter', 'Фильтры'],
          ['roots', 'Корни'],
          ['autolinks', 'Автосвязи'],
          ['forge', 'Кузница'],
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
                {label}{id === 'roots' ? <span className="goals-surface__submenu-muted">{rootsStageEnabled ? 'ВКЛ' : 'ВЫКЛ'}</span> : null}{id === 'autolinks' ? <span className="goals-surface__submenu-muted">ВЫКЛ</span> : null}
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
                  ) : <p>Раздел «{label}» в разработке.</p>}
                  {id === 'forge' ? <button ref={seedButtonRef} type="button" onClick={startSeed}>Посадить семя</button> : null}
                  {id === 'forge' && devUnlocked ? <button type="button" onClick={() => { void seedUniverse() }}>Засеять демо (×7)</button> : null}
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
        <article className={leftPanelCollapsed ? "goals-surface__left goals-pane goals-forest goals-surface__left--collapsed" : "goals-surface__left goals-pane goals-forest"}>
          <div className="goals-surface__section-head"><h2>Лес целей</h2><button type="button" onClick={() => setLeftPanelCollapsed((value) => !value)}>{leftPanelCollapsed ? "Развернуть" : "Свернуть"}</button></div>
          <p className="goals-pane__hint">Портфель целей: активные, архив и корзина.</p>{leftPanelCollapsed ? null : <>
          <div className="goals-surface__seed-actions">
            <button type="button" onClick={startSeed}>Посадить семя</button>
            {devUnlocked ? <button type="button" onClick={() => { void seedUniverse() }}>Засеять демо (×7)</button> : null}
          </div>
          <div className="settings-actions">
            <button type="button" className={forestViewMode === 'forest' ? 'filter-button filter-button--active' : 'filter-button'} onClick={() => setForestViewMode('forest')}>Лес</button>
            <button type="button" className={forestViewMode === 'roots' ? 'filter-button filter-button--active' : 'filter-button'} onClick={() => setForestViewMode('roots')}>Корни</button>
          </div>
          {forestViewMode === 'forest' ? (
            <div className="settings-actions">
              {(['active', 'archived', 'trashed'] as ForestTab[]).map((tab) => (
                <button key={tab} type="button" className={forestTab === tab ? 'filter-button filter-button--active' : 'filter-button'} onClick={() => setForestTab(tab)}>{forestTabLabels[tab]}</button>
              ))}
            </div>
          ) : null}
          {forestViewMode === 'forest' ? (
            <>
              <label>
                Поиск
                <input value={forestSearch} onChange={(event) => setForestSearch(event.target.value)} placeholder="Название цели" />
              </label>
              <label>
                Сортировка
                <select value={forestSort} onChange={(event) => setForestSort(event.target.value as ForestSort)}>
                  <option value="recent">Недавние</option>
                  <option value="progress">По прогрессу</option>
                  <option value="preset">По режиму</option>
                </select>
              </label>
              <div className="goals-forest__list" ref={forestListRef}>
                {visibleForestGoals.length === 0 ? (
                  <div className="goals-pane__empty">
                    <p><strong>В этой вкладке пока пусто.</strong></p>
                  </div>
                ) : (
                  groves.map(([groveTitle, groveGoals]) => (
                    <details key={groveTitle} open>
                      <summary>{groveTitle} · {groveGoals.length}</summary>
                      <ul>
                        {groveGoals.map((goal) => {
                          const children = goals.filter((item) => item.parentGoalId === goal.id && item.status === forestTab)
                          const progress = goalProgressMap.get(goal.id)
                          return (
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
                                  <span className="chip">Роща: {goal.groveId?.trim() || 'Без рощи'}</span>
                                  {goal.modePresetId ? <span className="chip">Режим: {modePresetsMap[goal.modePresetId].title}</span> : null}
                                </div>
                                <div className="goals-forest__meta" aria-label="Дополнительно">
                                  {goal.parentGoalId ? <span>Дочерняя цель</span> : null}
                                  {children.length ? <span>Супер-цель: {children.length}</span> : null}
                                  {typeof progress === 'number' ? <span>{Math.round(progress)}%</span> : null}
                                </div>
                                <div className="goals-forest__menu-wrap">
                                  <button
                                    type="button"
                                    className="filter-button"
                                    ref={(node) => {
                                      forestMenuTriggerRefs.current[goal.id] = node
                                    }}
                                    aria-label={`Открыть меню: ${goal.title}`}
                                    aria-haspopup="menu"
                                    aria-expanded={forestMenuGoalId === goal.id}
                                    aria-controls={`forest-menu-${goal.id}`}
                                    onClick={() => {
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
                          )
                        })}
                      </ul>
                    </details>
                  ))
                )}
              </div>
            </>
          ) : (
            <div className="goals-roots-map" aria-label="Карта корней">
              {!selected ? <p>Выберите цель в лесу, чтобы увидеть карту корней.</p> : null}
              {selected ? (
                <>
                  <h3>Карта корней: {selected.title}</h3>
                  <div className="goals-roots-map__hint-block">
                    <p className="goals-pane__hint">Связано по данным, не причина.</p>
                    <label className="goals-roots-map__toggle">
                      <input
                        type="checkbox"
                        checked={showAutoLinkSuggestions}
                        onChange={(event) => setShowAutoLinkSuggestions(event.target.checked)}
                      />
                      Подсказки
                    </label>
                  </div>
                  <div className="goals-roots-map__center">{selected.title}</div>
                  <div className="goals-roots-map__groups">
                    {(['depends_on', 'supports', 'conflicts'] as GoalLinkType[]).map((type) => (
                      <section key={type}>
                        <h4>{linkTypeLabels[type]}</h4>
                        <ul>
                          {selectedLinksByType[type].length ? selectedLinksByType[type].map((link) => (
                            <li key={`${type}-${link.toGoalId}`}>{goalTitleMap.get(link.toGoalId) ?? link.toGoalId}</li>
                          )) : <li>—</li>}
                        </ul>
                      </section>
                    ))}
                  </div>
                  {showAutoLinkSuggestions ? (
                    <section>
                      <h4>Подозреваемые связи</h4>
                      {autoLinkSuggestions.length === 0 ? <p className="goals-pane__hint">Недостаточно данных или сильных корреляций.</p> : null}
                      <ul className="goals-roots-suggestions">
                        {autoLinkSuggestions.map((item) => {
                          const relation = item.r >= 0 ? 'движутся вместе' : 'движутся в разные стороны'
                          return (
                            <li key={`${item.sourceGoalId}-${item.targetGoalId}`} className="goals-roots-suggestion-item">
                              <div>
                                <strong>{goalTitleMap.get(item.targetGoalId) ?? item.targetGoalId}</strong>
                                <p className="goals-pane__hint">r={item.r.toFixed(2)} · N={item.sampleSize} · {relation}</p>
                              </div>
                              <div className="goals-roots-suggestion-actions">
                                <span className="chip">Уверенность: {item.confidence}</span>
                                <select
                                  value={suggestionTypeDraftByGoalId[item.targetGoalId] ?? 'supports'}
                                  onChange={(event) => {
                                    const value = event.target.value as GoalLinkType
                                    setSuggestionTypeDraftByGoalId((current) => ({ ...current, [item.targetGoalId]: value }))
                                  }}
                                >
                                  <option value="supports">Помогает</option>
                                  <option value="depends_on">Зависит от</option>
                                  <option value="conflicts">Конфликтует</option>
                                </select>
                                <button type="button" onClick={async () => { await confirmAutoSuggestion(item.targetGoalId) }}>Подтвердить</button>
                                <button type="button" className="ghost-button" onClick={() => hideAutoSuggestion(item.targetGoalId)}>Скрыть</button>
                              </div>
                            </li>
                          )
                        })}
                      </ul>
                    </section>
                  ) : null}
                </>
              ) : null}
            </div>
          )}
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
                  candidate.focus()
                  return
                }
              }
            }

            const focusBoundary = (target: 'first' | 'last') => {
              const ordered = target === 'first' ? forestMenuItemRefs.current : [...forestMenuItemRefs.current].reverse()
              const nextItem = ordered.find((item) => item && !item.disabled)
              nextItem?.focus()
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
          </>}
        </article>

        <article className="goals-surface__stage goals-pane">
          <>
            {goalsStageMode === 'cells' ? (
              <GoalCellsStage
                goals={universeStageGoals}
                links={universeStageLinks}
                showLinks={rootsStageEnabled && Boolean(selectedGoalId)}
                selectedGoalId={selectedGoalId}
                selectedBranchId={selectedKrId}
                onSelectGoal={(goalId) => {
                  setSelectedGoalId(goalId)
                  setForestViewMode('forest')
                }}
                onSelectBranch={setSelectedKrId}
                onClearBranch={() => setSelectedKrId(null)}
                resetSignal={stageResetSignal}
                tooFewGoalsHint={forestTab === 'active' && universeStageGoals.length < 3 ? 'Добавьте ещё цели или откройте скрытый демо-режим.' : null}
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
            <h2>Кокпит</h2>
            <p>Целей: {goals.length} · Активных корней: {activeRoots.length}</p>
            <div className="goals-surface__dial-row"><span>Ритм</span><span>Устойчивость</span><span>Импульс</span></div>
            <p className="goals-pane__hint">Выбранная цель: {selectedUniverseGoal ? selectedUniverseGoal.title : '—'}</p>
            <p className="goals-pane__hint">Выбранный рычаг: {selectedUniverseLever ? selectedUniverseLever.title : '—'}</p>
            <div className="goals-pane__hint">
              Связи: поддержка {selectedLinksByType.supports.length} · зависимости {selectedLinksByType.depends_on.length} · конфликты {selectedLinksByType.conflicts.length}
            </div>
            <ul className="goals-stage-links-list">
              {selectedLinkedTargets.length ? selectedLinkedTargets.map((link) => (
                <li key={`${link.type}-${link.toGoalId}`}>
                  <strong>{linkTypeLabels[link.type]}:</strong> {link.title}
                </li>
              )) : <li>Для выбранной цели пока нет связанных целей.</li>}
            </ul>
          </section>
          <section className="goals-surface__cockpit-floor goals-surface__cockpit-floor--inspector">
          <h2>Друид</h2>
          {selected ? (
            <>
              <div className="goals-druid-headline">
                <p>
                  Статус дерева:{' '}
                  <span className={`status-badge ${treeState?.toneClass ?? 'status-badge--mid'}`}>
                    {treeState?.label ?? '—'}
                  </span>
                </p>
                <div className="goals-druid-mode-row">
                  <button ref={forgeOpenButtonRef} type="button" onClick={() => setIsForgeOpen(true)}>
                    Кузница / Настроить режим
                  </button>
                  <span className="chip">Режим: {selected.isManualTuning ? 'Ручной' : selectedPreset.title}</span>
                </div>
              </div>
              <div className="goals-druid-gauges" aria-label="Приборка состояния дерева">
                <DruidGauge label="Здоровье" value01={trunkHealth.value01} stateLabel={trunkHealth.label} stateKind={trunkHealth.stateKind} />
                <DruidGauge label="Шторм" value01={stormStatus.value01} stateLabel={stormStatus.label} stateKind={stormStatus.stateKind} />
                <DruidGauge label="Импульс" value01={impulseStatus.value01} stateLabel={impulseStatus.label} stateKind={impulseStatus.stateKind} />
              </div>
              <p><strong>Слабая ветвь:</strong> {weakestKr ? `🕸 Трещина: ${METRICS.find((item) => item.id === weakestKr.kr.metricId)?.labelRu ?? weakestKr.kr.metricId}` : 'Выберите ветвь'}</p>
              <p className="goals-pane__hint">{selected.isManualTuning ? 'Ручная настройка активна: Друид опирается на ваш профиль.' : selectedPreset.druidHint}</p>
              <p><strong>Выбранная ветвь:</strong> {selectedKrMetricLabel ?? 'Выберите ветвь'}</p>
              {supportsLinkedGoals.length > 0 ? (
                <div className="goals-inline-chip-wrap">
                  <button type="button" className="chip goals-inline-chip-button" onClick={() => setSupportsExpanded((value) => !value)}>
                    Поддержка: {supportsLinkedGoals.length}
                  </button>
                  {supportsExpanded ? (
                    <ul className="goals-inline-chip-list">
                      {supportsLinkedGoals.map((goal) => <li key={goal.id}>{goal.title}</li>)}
                    </ul>
                  ) : null}
                </div>
              ) : null}
              {conflictLinkedGoals.length > 0 && !isConflictHiddenToday ? (
                <div className="goals-inline-warning" role="status">
                  <strong>Конфликт ресурсов.</strong>{' '}
                  <span>Конфликтует с: {conflictLinkedGoals.map((goal) => goal.title).join(', ')}</span>
                  <div className="settings-actions">
                    <button type="button" onClick={() => { setSelectedGoalId(conflictLinkedGoals[0].id); setForestViewMode('forest') }}>Открыть</button>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => setHiddenConflictDayKeyByGoal((value) => ({ ...value, [selected.id]: currentDayKey }))}
                    >
                      Скрыть на сегодня
                    </button>
                  </div>
                </div>
              ) : null}
              {dependsLinkedGoals.length > 0 ? (
                <div className="goals-inline-depends">
                  {dependsLinkedGoals.map((goal) => (
                    <div key={goal.id} className="goals-inline-depends__row">
                      <span>
                        <strong>{goal.title}:</strong>{' '}
                        {goal.status === 'active' ? 'Зависимость активна' : 'Зависимость не активна'}
                      </span>
                      <div className="settings-actions">
                        <button type="button" onClick={() => { setSelectedGoalId(goal.id); setForestViewMode('forest') }}>Открыть</button>
                        {goal.status !== 'active' ? <button type="button" onClick={async () => { await restoreGoal(goal) }}>Восстановить</button> : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
              <section className="summary-card goals-roots-block">
                <div className="settings-actions">
                  <h3>Корни</h3>
                  <button type="button" onClick={openLinkModal}>Добавить связь</button>
                </div>
                {(['supports', 'depends_on', 'conflicts'] as GoalLinkType[]).map((type) => (
                  <div key={type}>
                    <strong>{linkTypeLabels[type]}</strong>
                    <ul>
                      {selectedLinksByType[type].length ? selectedLinksByType[type].map((link) => (
                        <li key={`${type}-${link.toGoalId}`} className="goals-roots-item">
                          <span>{goalTitleMap.get(link.toGoalId) ?? link.toGoalId}</span>
                          <div className="settings-actions">
                            <button type="button" onClick={() => { setSelectedGoalId(link.toGoalId); setForestViewMode('forest') }}>Открыть</button>
                            <button type="button" aria-label="Удалить связь" onClick={async () => { await removeGoalLink(link.toGoalId, type) }}>×</button>
                          </div>
                        </li>
                      )) : <li>—</li>}
                    </ul>
                  </div>
                ))}
              </section>
              {!activeMission ? (
                <div className="goals-tree-state__top-layer">
                  <h3>Следующая миссия</h3>
                  <label>
                    Длительность
                    <select value={nextMissionDuration} onChange={(event) => setNextMissionDuration(Number(event.target.value) as 1 | 3)}>
                      <option value={1}>1 день</option>
                      <option value={3}>3 дня</option>
                    </select>
                  </label>
                  <p><strong>Миссия:</strong> {nextMissionTitle}</p>
                  <div className="goals-mission-chips">
                    <span className="chip">⏱ {nextMissionTemplate?.timeBandMinutes ?? 15} мин</span>
                    {nextMissionEffect ? <span className="chip">Ядра: +{nextMissionEffect.min}…{nextMissionEffect.max} (обычно +{nextMissionEffect.expected})</span> : null}
                  </div>
                  <p className="goals-pane__hint">{nextMissionTemplate?.why ?? 'Чтобы усилить выбранную ветвь.'}</p>
                  {conflictAvoidTags.length > 0 ? <p className="goals-pane__hint">Автопилот избегает теги конфликта: {conflictAvoidTags.join(', ')}.</p> : null}
                  {nextMissionTemplate?.ifThenPlan ? (
                    <details open={missionDetailsOpen} onToggle={(event) => setMissionDetailsOpen((event.target as HTMLDetailsElement).open)}>
                      <summary>Как сделать</summary>
                      <p>{nextMissionTemplate.ifThenPlan}</p>
                    </details>
                  ) : null}
                  <button type="button" onClick={acceptMission} disabled={!missionTargetKr}>Принять миссию</button>
                  <button type="button" className="ghost-button" onClick={() => { void rerollMission() }} disabled={!canReroll}>
                    Другая миссия
                  </button>
                  <p className="goals-pane__hint">Повторы: {Math.max(0, MISSION_REROLL_LIMIT_PER_DAY - rerollsUsedToday)}/{MISSION_REROLL_LIMIT_PER_DAY} сегодня{rerollCooldownLeftMs > 0 ? ` · пауза ${Math.ceil(rerollCooldownLeftMs / 1000)}с` : ''}</p>
                </div>
              ) : (
                <div className="goals-druid-mission">
                  <h3>Активная миссия</h3>
                  <p><strong>{activeMission.title}</strong></p>
                  <p className="goals-pane__hint">{activeMission.why ?? 'Чтобы усилить выбранную ветвь.'}</p>
                  <div className="goals-mission-chips">
                    <span className="chip">⏱ {activeMission.timeBandMinutes ?? 15} мин</span>
                    <span className="chip">Ядра: +{activeMission.expectedMin}…{activeMission.expectedMax} (обычно +{activeMission.expectedDefault})</span>
                  </div>
                  <p>Прогресс по дням: {missionProgress}</p>
                  {activeMission.ifThenPlan ? (
                    <details>
                      <summary>Как сделать</summary>
                      <p>{activeMission.ifThenPlan}</p>
                    </details>
                  ) : null}
                  {missionProgress === 'День 1/3' ? (
                    <button type="button" className="ghost-button" onClick={() => { void replaceMission() }}>Заменить миссию</button>
                  ) : null}
                  <button ref={missionDoneButtonRef} type="button" onClick={openMissionConfirm}>Засчитать выполнение</button>
                </div>
              )}

              <div className="goals-druid-mission">
                <h3>Последние плоды</h3>
                {missionHistory.filter((item) => item.coresAwarded > 0).length === 0 ? <p className="goals-pane__hint">Плодов пока нет.</p> : null}
                {missionHistory.filter((item) => item.coresAwarded > 0).length > 0 ? (
                  <ul>
                    {missionHistory.filter((item) => item.coresAwarded > 0).map((item) => (
                      <li key={item.id}>
                        {item.title} · {item.durationDays} дн. · +{item.coresAwarded} ядер
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </>
          ) : (
            <div className="goals-pane__empty">
              <p><strong>Друид ждёт выбранную цель.</strong></p>
              <p>Выберите цель в Лесу или посадите семя, чтобы получить миссию на 3 дня.</p>
              <button type="button" onClick={startSeed}>Посадить семя</button>
              <button type="button" disabled title="Создайте цель, чтобы настраивать режим">Кузница / Настроить режим</button>
            </div>
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
