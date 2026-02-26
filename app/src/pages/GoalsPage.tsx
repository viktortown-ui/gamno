import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { METRICS } from '../core/metrics'
import type { GoalRecord } from '../core/models/goal'
import {
  addGoalEvent,
  addQuest,
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
import { GoalYggdrasilTree } from '../ui/components/GoalYggdrasilTree'

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

export function GoalsPage() {
  const navigate = useNavigate()
  const [goals, setGoals] = useState<GoalRecord[]>([])
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null)
  const [editor, setEditor] = useState<GoalRecord | null>(null)
  const [goalState, setGoalState] = useState<GoalStateInput | null>(null)
  const [historyTrend, setHistoryTrend] = useState<'up' | 'down' | null>(null)
  const [actions, setActions] = useState<ReturnType<typeof suggestGoalActions>>([])
  const [seedModalOpen, setSeedModalOpen] = useState(false)
  const [seedTemplate, setSeedTemplate] = useState<GoalTemplateId>('growth')
  const [seedTitle, setSeedTitle] = useState('')
  const [seedHorizon, setSeedHorizon] = useState<7 | 14 | 30>(14)
  const [duplicateCandidate, setDuplicateCandidate] = useState<GoalRecord | null>(null)

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

    if (picked?.id && currentState) {
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

  const nextMission = actions[0] ?? null

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

  const submitSeed = async (forceCreate = false) => {
    const normalizedTitle = seedTitle.trim()
    if (!normalizedTitle) return
    const duplicate = goals.find((item) => item.title.trim().toLowerCase() === normalizedTitle.toLowerCase())
    if (duplicate && !forceCreate) {
      setDuplicateCandidate(duplicate)
      return
    }

    const tpl = templates[seedTemplate]
    const created = await createGoal({
      title: normalizedTitle,
      description: tpl.description,
      horizonDays: seedHorizon,
      status: 'draft',
      template: seedTemplate,
      weights: tpl.weights,
      okr: { objective: tpl.objective, keyResults: [] },
    })

    await setActiveGoal(created.id)
    setSeedModalOpen(false)
    setDuplicateCandidate(null)
    setSelectedGoalId(created.id)
    await reload()
  }

  return (
    <section className="page">
      <h1>Цели</h1>
      <div className="settings-actions">
        <button
          type="button"
          onClick={() => {
            const focus = Object.entries(selected?.weights ?? {})
              .sort((a, b) => Math.abs((b[1] ?? 0)) - Math.abs((a[1] ?? 0)))
              .slice(0, 3)
            const impulses = Object.fromEntries(focus.map(([metricId, w]) => [metricId, (w ?? 0) > 0 ? 0.5 : -0.5]))
            window.localStorage.setItem('gamno.multiverseDraft', JSON.stringify({ impulses, focusMetrics: focus.map(([metricId]) => metricId), sourceLabelRu: 'Цель → Мультивселенная' }))
            navigate('/multiverse')
          }}
        >
          Открыть в Мультивселенной
        </button>
      </div>
      <div className="oracle-grid goals-layout">
        <article className="summary-card panel">
          <h2>Список целей</h2>
          <button type="button" onClick={startSeed}>Посадить семя</button>
          {goals.length === 0 ? <p>Пока нет целей.</p> : null}
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
        </article>

        <article className="summary-card panel">
          <h2>Редактор</h2>
          {editor ? (
            <>
              <label>Название<input value={editor.title} onChange={(e) => setEditor({ ...editor, title: e.target.value })} /></label>
              <label>Описание<textarea value={editor.description ?? ''} onChange={(e) => setEditor({ ...editor, description: e.target.value })} /></label>
              <label>
                Горизонт
                <select value={editor.horizonDays} onChange={(e) => setEditor({ ...editor, horizonDays: Number(e.target.value) as 7 | 14 | 30 })}>
                  <option value={7}>7 дней</option><option value={14}>14 дней</option><option value={30}>30 дней</option>
                </select>
              </label>
              <h3>Веса метрик</h3>
              {METRICS.map((metric) => (
                <label key={metric.id}>{metric.labelRu}: {(editor.weights[metric.id] ?? 0).toFixed(2)}
                  <input type="range" min={-1} max={1} step={0.1} value={editor.weights[metric.id] ?? 0} onChange={(e) => setEditor({ ...editor, weights: { ...editor.weights, [metric.id]: Number(e.target.value) } })} />
                </label>
              ))}
              <div className="settings-actions">
                <button type="button" onClick={async () => { await updateGoal(editor.id, editor); await reload() }}>Сохранить</button>
                <button type="button" onClick={async () => { await setActiveGoal(editor.id); await reload() }}>Сделать активной</button>
                <button type="button" onClick={async () => { await updateGoal(editor.id, { status: 'archived', active: false }); await reload() }}>Архивировать</button>
              </div>
            </>
          ) : <p>Выберите цель.</p>}
        </article>

        <article className="summary-card panel goals-tree-state">
          <h2>Состояние дерева</h2>
          {selected && scoring ? (
            <>
              <GoalYggdrasilTree
                goal={selected}
                actions={actions}
                weather={treeState?.label === 'Растёт' ? 'grow' : treeState?.label === 'Штормит' ? 'storm' : 'dry'}
              />
              <p>
                Статус:{' '}
                <span className={`status-badge ${treeState?.toneClass ?? 'status-badge--mid'}`}>
                  {treeState?.label ?? 'Штормит'}
                </span>
              </p>
              <p>
                Почему: {scoring.explainTop3.slice(0, 3).map((item) => `${item.title} — ${item.textRu}`).join('; ')}.
              </p>
              <h3>Следующий шаг</h3>
              {nextMission ? (
                <p>
                  <strong>{nextMission.titleRu}.</strong> {nextMission.rationaleRu}
                </p>
              ) : <p>Пока нет рекомендаций — добавьте свежий чек-ин.</p>}
              <button type="button" onClick={async () => {
                if (!nextMission) return
                await addQuest({
                  createdAt: Date.now(),
                  title: `Миссия цели: ${nextMission.titleRu}`,
                  metricTarget: nextMission.metricId,
                  delta: nextMission.impulse,
                  horizonDays: 3,
                  status: 'active',
                  predictedIndexLift: Math.max(0.1, nextMission.deltaIndex),
                  goalId: selected.id,
                })
                await addGoalEvent({ goalId: selected.id, goalScore: scoring.goalScore, goalGap: scoring.goalGap })
              }}>Принять миссию на 3 дня</button>

              <details className="graph-accordion">
                <summary>Подробнее (для продвинутых)</summary>
                <p>Сила роста: <strong>{scoring.goalScore.toFixed(1)}</strong>{historyTrend ? ` (${historyTrend === 'up' ? '↑' : '↓'})` : ''}</p>
                <p>Насколько далеко: <strong>{scoring.goalGap >= 0 ? '+' : ''}{scoring.goalGap.toFixed(1)}</strong></p>
                <p>Прогресс цели: <strong>{goalState?.index.toFixed(1)}</strong></p>
                <p>Риск шторма: <strong>{((goalState?.pCollapse ?? 0) * 100).toFixed(1)}%</strong></p>
                <h3>Топ-3 фактора</h3>
                <ul>{scoring.explainTop3.map((item) => <li key={item.key}><strong>{item.title}:</strong> {item.textRu}</li>)}</ul>
                <h3>3 лучших действия</h3>
                <ol>{actions.map((item) => <li key={`${item.metricId}-${item.impulse}`}><strong>{item.titleRu}</strong> · Δсилы роста {item.deltaGoalScore >= 0 ? '+' : ''}{item.deltaGoalScore.toFixed(1)} · Δпрогресса цели {item.deltaIndex >= 0 ? '+' : ''}{item.deltaIndex.toFixed(2)} · Δриска шторма {(item.deltaPCollapse * 100).toFixed(1)} п.п.<br />{item.rationaleRu}</li>)}</ol>
                <h3>Как читать формулы</h3>
                <ul>
                  <li>Сила роста = текущая оценка вашей цели по выбранным весам метрик.</li>
                  <li>Насколько далеко = отклонение от целевого уровня (ниже — лучше).</li>
                  <li>Риск шторма = вероятность провала устойчивости P(collapse) в понятной форме.</li>
                </ul>
              </details>
            </>
          ) : <p>Нет данных для оценки состояния дерева.</p>}
        </article>
      </div>

      {seedModalOpen ? (
        <div className="panel" role="dialog" aria-modal="true">
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
                <button type="button" onClick={() => { setSelectedGoalId(duplicateCandidate.id); setEditor(duplicateCandidate); setSeedModalOpen(false); setDuplicateCandidate(null) }}>Открыть</button>
                <button type="button" onClick={async () => { await submitSeed(true) }}>Всё равно создать</button>
              </div>
            </div>
          ) : null}
          <div className="settings-actions">
            <button type="button" onClick={async () => { await submitSeed() }}>Создать</button>
            <button type="button" onClick={() => setSeedModalOpen(false)}>Отмена</button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
