import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { METRICS, type MetricId } from '../core/metrics'
import type { GoalKeyResult, GoalModePresetId, GoalRecord } from '../core/models/goal'
import {
  addGoalEvent,
  createGoal,
  getActiveGoal,
  getLatestRegimeSnapshot,
  getLatestStateSnapshot,
  listCheckins,
  listGoalEvents,
  listGoals,
  loadInfluenceMatrix,
  setActiveGoal,
  updateGoal,
} from '../core/storage/repo'
import { evaluateGoalScore, suggestGoalActions, type GoalStateInput } from '../core/engines/goal'
import { getLatestForecastRun } from '../repo/forecastRepo'
import { GoalYggdrasilTree, type BranchStrength } from '../ui/components/GoalYggdrasilTree'
import { DruidGauge } from './goals/components/DruidGauge'
import { ForgeSheet } from './goals/components/ForgeSheet'
import { PresetSelector } from './goals/components/PresetSelector'
import { RuneDial } from './goals/components/RuneDial'
import { ForgePreview } from './goals/components/ForgePreview'
import { AdvancedTuning } from './goals/components/AdvancedTuning'

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

const missionTemplatesByMetric: Record<MetricId, string[]> = {
  sleepHours: ['Ритуал сна 20 минут', 'Отбой на 30 минут раньше', 'Тихий час без экрана перед сном', 'Подготовить спальню до 22:00', 'Подъём в одно и то же время'],
  energy: ['10 минут прогулка', 'Стакан воды сразу после подъёма', 'Короткая зарядка 7 минут', 'Пауза на восстановление днём', 'Режим воды + еды по графику'],
  stress: ['3 минуты дыхание', 'Снять один раздражитель', '15 минут без уведомлений', 'Короткая пауза на тело', 'Записать и закрыть тревожную мысль'],
  focus: ['Один блок глубокой работы 25 минут', 'Отключить отвлечения на первый спринт', 'Сделать главный шаг до обеда', 'План из трёх фокус-задач', 'Пять минут планирования перед стартом'],
  productivity: ['Закрыть 1 приоритет до 12:00', 'Разобрать список задач на сегодня', 'Сделать 2 коротких спринта', 'Закрыть одну зависшую задачу', 'Подготовить старт следующего дня'],
  mood: ['Короткая прогулка на свету', '1 действие для подъёма настроения', 'Музыкальная пауза 5 минут', 'Записать три хорошие вещи дня', 'Тёплый контакт с близким человеком'],
  social: ['Один качественный разговор', 'Сообщение поддержки важному человеку', 'Короткий звонок вместо переписки', '15 минут на живой контакт', 'План одной встречи на неделю'],
  health: ['10 минут мягкой активности', 'Полезный приём пищи по режиму', 'Пауза на осанку и дыхание', 'Контроль воды за день', 'Короткая разминка между задачами'],
  cashFlow: ['Проверить один финансовый поток', 'Закрыть один денежный хвост', 'Сделать действие для дохода', 'Разобрать одну расходную утечку', 'Обновить недельный денежный план'],
}

const missionDurationOptions: Record<1 | 3, { min: number; max: number; expected: number }> = {
  1: { min: 1, max: 4, expected: 2 },
  3: { min: 3, max: 8, expected: 5 },
}

function missionProgressLabel(startedAt: number, durationDays: 1 | 3): string {
  const passedDays = Math.max(1, Math.ceil((Date.now() - startedAt) / (24 * 60 * 60 * 1000) + 0.01))
  const capped = Math.min(durationDays, passedDays)
  return `день ${capped}/${durationDays}`
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
  const [actions, setActions] = useState<ReturnType<typeof suggestGoalActions>>([])
  const [selectedKrId, setSelectedKrId] = useState<string | null>(null)
  const [stageResetSignal, setStageResetSignal] = useState(0)
  const [seedModalOpen, setSeedModalOpen] = useState(false)
  const [seedTemplate, setSeedTemplate] = useState<GoalTemplateId>('growth')
  const [seedTitle, setSeedTitle] = useState('')
  const [seedHorizon, setSeedHorizon] = useState<7 | 14 | 30>(14)
  const [duplicateCandidate, setDuplicateCandidate] = useState<GoalRecord | null>(null)
  const [isForgeOpen, setIsForgeOpen] = useState(false)
  const [showDebugNumbers, setShowDebugNumbers] = useState(false)
  const forgeOpenButtonRef = useRef<HTMLButtonElement | null>(null)
  const [nextMissionDuration, setNextMissionDuration] = useState<1 | 3>(3)
  const [missionConfirmOpen, setMissionConfirmOpen] = useState(false)
  const [missionAwardDraft, setMissionAwardDraft] = useState(5)
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
      const matrix = await loadInfluenceMatrix()
      if (cancelled) return
      setActions(suggestGoalActions(selected, goalState, matrix))
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
    const duplicate = goals.find((item) => item.title.trim().toLowerCase() === normalizedTitle.toLowerCase())
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
      status: 'draft',
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

  const selectedKrAction = useMemo(() => {
    if (!selectedKrRow) return null
    return actions.find((item) => item.metricId === selectedKrRow.kr.metricId) ?? null
  }, [actions, selectedKrRow])

  const missionTargetKr = selectedKrRow ?? weakestKr ?? null

  const nextMissionTitle = useMemo(() => {
    if (!missionTargetKr) return 'Выберите ветвь на сцене, чтобы получить миссию.'
    const templates = missionTemplatesByMetric[missionTargetKr.kr.metricId] ?? []
    if (templates.length > 0) {
      const hash = missionTargetKr.kr.id.split('').reduce((acc, symbol) => acc + symbol.charCodeAt(0), 0)
      return templates[hash % templates.length]
    }
    return selectedKrAction?.titleRu ?? `Ритуал по ветви «${selectedKrMetricLabel ?? missionTargetKr.kr.metricId}»`
  }, [missionTargetKr, selectedKrAction, selectedKrMetricLabel])

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
    if (!scoring) return { label: 'N/A', stateKind: 'na' as const, value01: null }
    if (scoring.goalGap <= -5) return { label: 'Норма', stateKind: 'good' as const, value01: 0.8 }
    if (scoring.goalGap <= 2) return { label: 'Под риском', stateKind: 'warn' as const, value01: 0.5 }
    return { label: 'Критично', stateKind: 'bad' as const, value01: 0.2 }
  }, [scoring])

  const stormStatus = useMemo(() => {
    if (typeof goalState?.pCollapse !== 'number') {
      return { label: 'N/A', stateKind: 'na' as const, value01: null }
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

  const acceptMission = async () => {
    if (!selected || !missionTargetKr || activeMission) return
    const now = Date.now()
    const missionRange = missionDurationOptions[nextMissionDuration]
    await updateGoal(selected.id, {
      activeMission: {
        id: `mission-${now}`,
        goalId: selected.id,
        krKey: missionTargetKr.kr.id,
        title: nextMissionTitle,
        durationDays: nextMissionDuration,
        startedAt: now,
        endsAt: now + nextMissionDuration * 24 * 60 * 60 * 1000,
        expectedMin: missionRange.min,
        expectedMax: missionRange.max,
        expectedDefault: missionRange.expected,
      },
    })
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


  return (
    <section className="goals-page">
      <div className="goals-page__topbar">
        <h1>Цели</h1>
        <div className="settings-actions">
          <button ref={seedButtonRef} type="button" onClick={startSeed}>Посадить семя</button>
          <button
            type="button"
            onClick={() => {
            if (!selected) return
            const focus = Object.entries(selectedWeights)
              .sort((a, b) => Math.abs((b[1] ?? 0)) - Math.abs((a[1] ?? 0)))
              .slice(0, 3)
            const impulses = Object.fromEntries(focus.map(([metricId, w]) => [metricId, (w ?? 0) > 0 ? 0.5 : -0.5]))
            window.localStorage.setItem('gamno.multiverseDraft', JSON.stringify({
              impulses,
              focusMetrics: focus.map(([metricId]) => metricId),
              sourceLabelRu: 'Цель+миссия → Мультивселенная',
              activeGoal: { id: selected.id, title: selected.title, objective: selected.okr.objective },
              activeMission: selected.activeMission,
            }))
              navigate('/multiverse')
            }}
          >
            Открыть в Мультивселенной
          </button>
        </div>
      </div>



      <div className="goals-aaa-grid">
        <article className="panel goals-pane goals-pane--forest goals-forest">
          <h2>Лес целей</h2>
          <p className="goals-pane__hint">Список целей прокручивается внутри панели.</p>
          <button type="button" onClick={startSeed}>Посадить семя</button>
          <div className="goals-forest__list">
            {goals.length === 0 ? (
              <div className="goals-pane__empty">
                <p><strong>Пока нет целей.</strong></p>
                <p>Начните с одного семени и выберите горизонт в 7, 14 или 30 дней.</p>
              </div>
            ) : (
              <ul>
                {goals.map((goal) => (
                  <li key={goal.id}>
                    <button
                      type="button"
                      className={selectedGoalId === goal.id ? 'filter-button filter-button--active' : 'filter-button'}
                      onClick={() => {
                        setSelectedGoalId(goal.id)
                        setEditor(goal)
                      }}
                    >
                      {goal.title} {goal.active ? '· Активна' : ''} {goal.status === 'archived' ? '· Архив' : ''}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </article>

        <article className="panel goals-pane goals-pane--stage">
          {selected ? (
            <GoalYggdrasilTree
              objective={selected.okr.objective}
              branches={yggdrasilBranches}
              selectedBranchId={selectedKrId}
              onSelectBranch={setSelectedKrId}
              resetSignal={stageResetSignal}
            />
          ) : (
            <div className="goals-pane__empty goals-pane__empty--stage">
              <p><strong>Выберите цель, чтобы увидеть сцену дерева.</strong></p>
              <p>Когда цель выбрана, здесь появится Иггдрасиль, ветви и фокус на следующем шаге.</p>
              <button type="button" onClick={startSeed}>Посадить семя</button>
            </div>
          )}

          <p className="goals-stage-legend">Толще = приоритет · Трещина = слабая · Плод = активная миссия</p>

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

        <article className="panel goals-pane goals-pane--druid goals-tree-state">
          <h2>Друид</h2>
          {selected ? (
            <>
              <div className="goals-druid-headline">
                <p>
                  Статус дерева:{' '}
                  <span className={`status-badge ${treeState?.toneClass ?? 'status-badge--mid'}`}>
                    {treeState?.label ?? 'N/A'}
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
                  <button type="button" onClick={acceptMission} disabled={!missionTargetKr}>Принять миссию</button>
                </div>
              ) : (
                <div className="goals-druid-mission">
                  <h3>Активная миссия</h3>
                  <p><strong>{activeMission.title}</strong></p>
                  <p>Прогресс по дням: {missionProgress}</p>
                  <button ref={missionDoneButtonRef} type="button" onClick={openMissionConfirm}>Засчитать выполнение</button>
                </div>
              )}

              <div className="goals-druid-mission">
                <h3>Последние плоды</h3>
                {missionHistory.length === 0 ? <p className="goals-pane__hint">Плодов пока нет.</p> : null}
                {missionHistory.length > 0 ? (
                  <ul>
                    {missionHistory.map((item) => (
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
        </article>
      </div>


      {editor ? (
        <ForgeSheet open={isForgeOpen} onClose={closeForge} title="Кузница: настройка режима">
          <header className="forge-sheet__header">
            <div>
              <p className="forge-sheet__eyebrow">Forge Cockpit</p>
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
            <label>Objective<input value={editor.okr.objective} onChange={(e) => setEditor({ ...editor, okr: { ...editor.okr, objective: e.target.value } })} /></label>
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
                <p>Такая цель уже есть: открыть её?</p>
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
