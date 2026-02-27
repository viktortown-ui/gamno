import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { METRICS, type MetricId } from '../core/metrics'
import type { GoalKeyResult, GoalMission, GoalMissionAction, GoalRecord } from '../core/models/goal'
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
  const [seedModalOpen, setSeedModalOpen] = useState(false)
  const [seedTemplate, setSeedTemplate] = useState<GoalTemplateId>('growth')
  const [seedTitle, setSeedTitle] = useState('')
  const [seedHorizon, setSeedHorizon] = useState<7 | 14 | 30>(14)
  const [duplicateCandidate, setDuplicateCandidate] = useState<GoalRecord | null>(null)
  const seedButtonRef = useRef<HTMLButtonElement | null>(null)
  const seedDialogRef = useRef<HTMLDivElement | null>(null)

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

  const scoring = useMemo(() => {
    if (!selected || !goalState) return null
    return evaluateGoalScore(selected, goalState)
  }, [selected, goalState])

  const treeState = useMemo(() => {
    if (!scoring) return null
    if (scoring.goalGap <= -5) return { label: 'Растёт', toneClass: 'status-badge--low' }
    if (scoring.goalGap <= 2) return { label: 'Штормит', toneClass: 'status-badge--mid' }
    return { label: 'Сохнет', toneClass: 'status-badge--high' }
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
    })

    await setActiveGoal(created.id)
    setSeedModalOpen(false)
    setDuplicateCandidate(null)
    setSelectedGoalId(created.id)
    await reload()
  }

  const selectedKrs = useMemo(() => {
    if (!selected) return []
    return ensureGoalKeyResults(selected, goalState)
  }, [selected, goalState])

  useEffect(() => {
    if (selectedKrs.length === 0) {
      setSelectedKrId(null)
      return
    }

    if (selectedKrId && selectedKrs.some((item) => item.id === selectedKrId)) {
      return
    }

    const weakest = [...selectedKrs]
      .map((kr) => {
        const metric = METRICS.find((item) => item.id === kr.metricId)
        const metricValue = goalState?.metrics[kr.metricId] ?? 0
        const progress = metric
          ? kr.direction === 'up'
            ? clamp01((metricValue - metric.min) / (metric.max - metric.min || 1))
            : clamp01((metric.max - metricValue) / (metric.max - metric.min || 1))
          : 0
        return { krId: kr.id, progress }
      })
      .sort((a, b) => a.progress - b.progress)[0]

    setSelectedKrId(weakest?.krId ?? selectedKrs[0]?.id ?? null)
  }, [goalState, selectedKrId, selectedKrs])

  const krProgressRows = useMemo(() => {
    if (!goalState) return []
    return selectedKrs.map((kr) => {
      const metric = METRICS.find((item) => item.id === kr.metricId)
      const metricValue = goalState.metrics[kr.metricId]
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
    if (!selectedKrId) return weakestKr
    return krProgressRows.find((row) => row.kr.id === selectedKrId) ?? weakestKr
  }, [krProgressRows, selectedKrId, weakestKr])

  const selectedKrMetricLabel = useMemo(() => {
    if (!selectedKrRow) return null
    return METRICS.find((item) => item.id === selectedKrRow.kr.metricId)?.labelRu ?? selectedKrRow.kr.metricId
  }, [selectedKrRow])

  const selectedKrAction = useMemo(() => {
    if (!selectedKrRow) return null
    return actions.find((item) => item.metricId === selectedKrRow.kr.metricId) ?? null
  }, [actions, selectedKrRow])

  const nextMissionStep = useMemo(() => {
    if (!selectedKrRow) {
      return 'Обновите состояние, чтобы получить следующий шаг.'
    }

    const activeMissionStep = selected?.activeMission?.actions.find((item) => !item.done && item.krId === selectedKrRow.kr.id)?.title
    if (activeMissionStep) return activeMissionStep
    if (selectedKrAction?.titleRu) return selectedKrAction.titleRu
    if (selectedKrMetricLabel) {
      const metricName = selectedKrMetricLabel
      return `Поддержите ветвь «${metricName}» коротким ритуалом сегодня.`
    }
    return 'Обновите состояние, чтобы получить следующий шаг.'
  }, [selected, selectedKrAction, selectedKrMetricLabel, selectedKrRow])

  const activeMission = selected?.activeMission
  const missionCompleted = Boolean(activeMission?.completedAt)

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
    return krProgressRows.map((row, index) => {
      const label = METRICS.find((item) => item.id === row.kr.metricId)?.labelRu ?? row.kr.metricId
      const weight = selected?.weights[row.kr.metricId] ?? 0
      const runeLevel = Math.max(1, Math.min(5, Math.round(Math.abs(weight) * 5)))
      const rune = (['I', 'II', 'III', 'IV', 'V'][runeLevel - 1] ?? 'I') as 'I' | 'II' | 'III' | 'IV' | 'V'
      const strength: BranchStrength = row.progress < 0.34 ? 'weak' : row.progress < 0.67 ? 'normal' : 'strong'
      return {
        id: row.kr.id,
        title: label,
        direction: row.kr.direction,
        rune,
        strength,
        missions: (selected?.activeMission?.actions ?? [])
          .filter((action) => action.krId === row.kr.id)
          .slice(0, 3)
          .map((action) => ({ id: action.id, title: action.title, done: action.done })),
        index,
      }
    })
  }, [krProgressRows, selected])

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
    if (!selected || !selectedKrRow) return
    const generatedActions: GoalMissionAction[] = [selectedKrRow.kr].map((kr, index) => {
      const recommendation = actions.find((item) => item.metricId === kr.metricId)
      return {
        id: `${kr.id}-a-${index}`,
        metricId: kr.metricId,
        krId: kr.id,
        done: false,
        title: recommendation?.titleRu ?? `Ритуал по ветви: ${METRICS.find((item) => item.id === kr.metricId)?.labelRu ?? kr.metricId}`,
      }
    })

    const mission: GoalMission = {
      id: `mission-${Date.now()}`,
      createdAt: Date.now(),
      horizonDays: 3,
      actions: generatedActions,
    }

    await updateGoal(selected.id, { activeMission: mission, fruitBadge: undefined })
    await reload()
  }

  const toggleMissionAction = async (actionId: string, done: boolean) => {
    if (!selected?.activeMission) return
    const actionsUpdated = selected.activeMission.actions.map((item) => item.id === actionId ? { ...item, done } : item)
    const completed = actionsUpdated.every((item) => item.done)

    const updatedKrs = selectedKrs.map((kr) => {
      const completedForKr = actionsUpdated.some((item) => item.krId === kr.id && item.done)
      if (!completedForKr) return kr
      const current = typeof kr.progress === 'number' ? kr.progress : 0
      return { ...kr, progressMode: 'manual' as const, progress: clamp01(current + 0.34) }
    })

    await updateGoal(selected.id, {
      okr: { ...selected.okr, keyResults: updatedKrs },
      activeMission: {
        ...selected.activeMission,
        actions: actionsUpdated,
        completedAt: completed ? Date.now() : undefined,
        rewardBadge: completed ? '🍎 Плод миссии: 3/3' : undefined,
      },
      fruitBadge: completed ? '🍎 Плод миссии' : selected.fruitBadge,
    })

    if (completed && scoring) {
      await addGoalEvent({ goalId: selected.id, goalScore: scoring.goalScore + 0.7, goalGap: scoring.goalGap - 0.5 })
    }
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
            const focus = Object.entries(selected.weights)
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
              onFocusTrunk={() => setSelectedKrId(null)}
            />
          ) : (
            <div className="goals-pane__empty goals-pane__empty--stage">
              <p><strong>Выберите цель, чтобы увидеть сцену дерева.</strong></p>
              <p>Когда цель выбрана, здесь появится Иггдрасиль, ветви и фокус на следующем шаге.</p>
              <button type="button" onClick={startSeed}>Посадить семя</button>
            </div>
          )}

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
              <p>
                Статус дерева:{' '}
                <span className={`status-badge ${treeState?.toneClass ?? 'status-badge--mid'}`}>
                  {treeState?.label ?? 'N/A'}
                </span>
              </p>
              <div className="goals-druid-gauges" aria-label="Приборка состояния дерева">
                <DruidGauge label="Здоровье" value01={trunkHealth.value01} stateLabel={trunkHealth.label} stateKind={trunkHealth.stateKind} />
                <DruidGauge label="Шторм" value01={stormStatus.value01} stateLabel={stormStatus.label} stateKind={stormStatus.stateKind} />
                <DruidGauge label="Импульс" value01={impulseStatus.value01} stateLabel={impulseStatus.label} stateKind={impulseStatus.stateKind} />
              </div>
              <p><strong>Слабая ветвь:</strong> {weakestKr ? (METRICS.find((item) => item.id === weakestKr.kr.metricId)?.labelRu ?? weakestKr.kr.metricId) : '—'}</p>
              <p><strong>Выбранная ветвь:</strong> {selectedKrMetricLabel ?? '—'}</p>
              <div className="goals-tree-state__top-layer panel">
                <p><strong>Следующий шаг:</strong> {nextMissionStep}</p>
                <button type="button" onClick={acceptMission} disabled={Boolean(activeMission && !missionCompleted)}>Принять миссию</button>
              </div>

              <h3>Миссия на 3 дня</h3>
              {activeMission ? (
                <div className="panel goals-druid-mission">
                  <p>Миссия {missionCompleted ? 'выполнена' : 'активна'}.</p>
                  <ul>
                    {activeMission.actions
                      .filter((action) => !selectedKrId || action.krId === selectedKrId)
                      .map((action) => (
                      <li key={action.id}>
                        <label>
                          <input type="checkbox" checked={action.done} onChange={(e) => { void toggleMissionAction(action.id, e.target.checked) }} /> {action.title}
                        </label>
                      </li>
                      ))}
                  </ul>
                  {activeMission.rewardBadge ? <p className="chip">{activeMission.rewardBadge}</p> : null}
                  {selected.fruitBadge ? <p className="chip">{selected.fruitBadge}</p> : null}
                </div>
              ) : (
                <p className="goals-pane__hint">Миссия ещё не принята.</p>
              )}
            </>
          ) : (
            <div className="goals-pane__empty">
              <p><strong>Друид ждёт выбранную цель.</strong></p>
              <p>Выберите цель в Лесу или посадите семя, чтобы получить миссию на 3 дня.</p>
              <button type="button" onClick={startSeed}>Посадить семя</button>
            </div>
          )}
        </article>
      </div>

      {editor ? (
        <details className="graph-accordion">
          <summary>Кузница (для продвинутых)</summary>
          <article className="summary-card panel">
            <h3>Настройка цели</h3>
            <label>Название<input value={editor.title} onChange={(e) => setEditor({ ...editor, title: e.target.value })} /></label>
            <label>Objective<input value={editor.okr.objective} onChange={(e) => setEditor({ ...editor, okr: { ...editor.okr, objective: e.target.value } })} /></label>
            <label>Описание<textarea value={editor.description ?? ''} onChange={(e) => setEditor({ ...editor, description: e.target.value })} /></label>
            <label>
              Горизонт
              <select value={editor.horizonDays} onChange={(e) => setEditor({ ...editor, horizonDays: Number(e.target.value) as 7 | 14 | 30 })}>
                <option value={7}>7 дней</option><option value={14}>14 дней</option><option value={30}>30 дней</option>
              </select>
            </label>

            <h4>Веса метрик</h4>
            {METRICS.map((metric) => (
              <label key={metric.id}>{metric.labelRu}: {(editor.weights[metric.id] ?? 0).toFixed(2)}
                <input type="range" min={-1} max={1} step={0.1} value={editor.weights[metric.id] ?? 0} onChange={(e) => setEditor({ ...editor, weights: { ...editor.weights, [metric.id]: Number(e.target.value) } })} />
              </label>
            ))}

            <h4>KR и прогресс</h4>
            {editorKeyResults.map((kr, index) => (
              <div key={kr.id} className="panel" style={{ marginBottom: 8 }}>
                <strong>KR{index + 1}: {METRICS.find((item) => item.id === kr.metricId)?.labelRu ?? kr.metricId}</strong>
                <label>
                  Направление
                  <select value={kr.direction} onChange={(e) => updateEditorKr(kr.id, { direction: e.target.value as 'up' | 'down' })}>
                    <option value="up">Вверх</option>
                    <option value="down">Вниз</option>
                  </select>
                </label>
                <label>
                  Цель (опционально)
                  <input type="number" value={kr.target ?? ''} onChange={(e) => updateEditorKr(kr.id, { target: e.target.value ? Number(e.target.value) : undefined })} />
                </label>
                <label>
                  Режим прогресса
                  <select value={kr.progressMode ?? 'auto'} onChange={(e) => updateEditorKr(kr.id, { progressMode: e.target.value as 'auto' | 'manual' })}>
                    <option value="auto">Авто</option>
                    <option value="manual">Ручной</option>
                  </select>
                </label>
                {(kr.progressMode ?? 'auto') === 'manual' ? (
                  <label>
                    Progress (0..1)
                    <input type="number" min={0} max={1} step={0.1} value={kr.progress ?? 0} onChange={(e) => updateEditorKr(kr.id, { progress: clamp01(Number(e.target.value || 0)) })} />
                  </label>
                ) : null}
              </div>
            ))}

            {scoring ? (
              <div>
                <p>Сила роста: <strong>{scoring.goalScore.toFixed(1)}</strong>{historyTrend ? ` (${historyTrend === 'up' ? '↑' : '↓'})` : ''}</p>
                <p>Насколько далеко: <strong>{scoring.goalGap >= 0 ? '+' : ''}{scoring.goalGap.toFixed(1)}</strong></p>
                <p>Прогресс цели: <strong>{goalState?.index.toFixed(1)}</strong></p>
                <p>Риск шторма: <strong>{((goalState?.pCollapse ?? 0) * 100).toFixed(1)}%</strong></p>
              </div>
            ) : null}

            <div className="settings-actions">
              <button type="button" onClick={async () => { await updateGoal(editor.id, editor); await reload() }}>Сохранить</button>
              <button type="button" onClick={async () => { await setActiveGoal(editor.id); await reload() }}>Сделать активной</button>
              <button type="button" onClick={async () => { await updateGoal(editor.id, { status: 'archived', active: false }); await reload() }}>Архивировать</button>
            </div>
          </article>
        </details>
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
