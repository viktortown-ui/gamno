import { useEffect, useMemo, useState } from 'react'
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

const defaultGoal: Omit<GoalRecord, 'id' | 'createdAt' | 'updatedAt'> = {
  title: 'Удержать устойчивый рост',
  description: 'Фокус на росте индекса при контроле риска.',
  horizonDays: 14,
  weights: { energy: 0.6, stress: -0.8, sleepHours: 0.4, productivity: 0.6 },
  targetIndex: 7,
  targetPCollapse: 0.2,
  constraints: { maxPCollapse: 0.25, sirenCap: 'amber', maxEntropy: 6 },
  status: 'active',
}

export function GoalsPage() {
  const [goals, setGoals] = useState<GoalRecord[]>([])
  const [selectedGoalId, setSelectedGoalId] = useState<number | null>(null)
  const [editor, setEditor] = useState<GoalRecord | null>(null)
  const [goalState, setGoalState] = useState<GoalStateInput | null>(null)
  const [historyTrend, setHistoryTrend] = useState<'up' | 'down' | null>(null)

  const reload = async () => {
    const [allGoals, active, latestState, latestRegime, checkins, latestForecast, matrix] = await Promise.all([
      listGoals(),
      getActiveGoal(),
      getLatestStateSnapshot(),
      getLatestRegimeSnapshot(),
      listCheckins(),
      getLatestForecastRun(),
      loadInfluenceMatrix(),
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
      forecast: latestForecast ? {
        p10: latestForecast.index.p10.at(-1),
        p50: latestForecast.index.p50.at(-1),
        p90: latestForecast.index.p90.at(-1),
      } : undefined,
    }

    setGoalState(currentState)

    if (active?.id) {
      const rows = await listGoalEvents(active.id, 2)
      if (rows.length >= 2) {
        setHistoryTrend(rows[0].goalScore >= rows[1].goalScore ? 'up' : 'down')
      } else {
        setHistoryTrend(null)
      }
      if (picked?.id && currentState) {
        const score = evaluateGoalScore(picked, currentState)
        const actions = suggestGoalActions(picked, currentState, matrix)
        if (actions[0]) {
          await addGoalEvent({ goalId: picked.id, goalScore: score.goalScore, goalGap: score.goalGap })
        }
      }
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

  const [actions, setActions] = useState<ReturnType<typeof suggestGoalActions>>([])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      if (!selected || !goalState) return
      const matrix = await loadInfluenceMatrix()
      if (cancelled) return
      setActions(suggestGoalActions(selected, goalState, matrix))
    }
    void run()
    return () => { cancelled = true }
  }, [selected, goalState])

  if (!goals.length) {
    return (
      <section className="page">
        <h1>Цели</h1>
        <article className="empty-state panel">
          <h2>Цель = автопилот решений</h2>
          <p>Сформулируйте вектор цели, чтобы системы влияний, режимов и прогнозов работали как единый контур выбора действий.</p>
          <button type="button" onClick={async () => { await createGoal(defaultGoal); await reload() }}>Создать цель</button>
        </article>
      </section>
    )
  }

  return (
    <section className="page">
      <h1>Цели</h1>
      <div className="oracle-grid goals-layout">
        <article className="summary-card panel">
          <h2>Список целей</h2>
          <button type="button" onClick={async () => { const created = await createGoal(defaultGoal); setSelectedGoalId(created.id ?? null); await setActiveGoal(created.id!); await reload() }}>Создать цель</button>
          <ul>
            {goals.map((goal) => (
              <li key={goal.id}>
                <button type="button" className={selectedGoalId === goal.id ? 'filter-button filter-button--active' : 'filter-button'} onClick={() => { setSelectedGoalId(goal.id ?? null); setEditor(goal) }}>{goal.title} {goal.status === 'active' ? '●' : ''}</button>
              </li>
            ))}
          </ul>
        </article>

        <article className="summary-card panel">
          <h2>Редактор</h2>
          {editor ? <>
            <label>Название<input value={editor.title} onChange={(e) => setEditor({ ...editor, title: e.target.value })} /></label>
            <label>Описание<textarea value={editor.description ?? ''} onChange={(e) => setEditor({ ...editor, description: e.target.value })} /></label>
            <label>Горизонт
              <select value={editor.horizonDays} onChange={(e) => setEditor({ ...editor, horizonDays: Number(e.target.value) as 7 | 14 | 30 | 90 })}>
                <option value={7}>7 дней</option><option value={14}>14 дней</option><option value={30}>30 дней</option><option value={90}>90 дней</option>
              </select>
            </label>
            <h3>Веса метрик</h3>
            {METRICS.filter((metric) => metric.id !== 'cashFlow').map((metric) => (
              <label key={metric.id}>{metric.labelRu}: {(editor.weights[metric.id] ?? 0).toFixed(2)}
                <input type="range" min={-1} max={1} step={0.1} value={editor.weights[metric.id] ?? 0} onChange={(e) => setEditor({ ...editor, weights: { ...editor.weights, [metric.id]: Number(e.target.value) } })} />
              </label>
            ))}
            <label>Предел P(collapse)<input type="number" step={0.01} value={editor.constraints?.maxPCollapse ?? 0.25} onChange={(e) => setEditor({ ...editor, constraints: { ...editor.constraints, maxPCollapse: Number(e.target.value) } })} /></label>
            <div className="settings-actions">
              <button type="button" onClick={async () => {
                if (!editor.id) return
                await updateGoal(editor.id, editor)
                await reload()
              }}>Сохранить</button>
              <button type="button" onClick={async () => { if (!editor.id) return; await setActiveGoal(editor.id); await reload() }}>Сделать активной</button>
            </div>
          </> : null}
        </article>

        <article className="summary-card panel">
          <h2>Гравитация цели</h2>
          {selected && scoring ? (
            <>
              <p>Индекс цели: <strong>{scoring.goalScore.toFixed(1)}</strong>{historyTrend ? ` (${historyTrend === 'up' ? '↑' : '↓'})` : ''}</p>
              <p>Разрыв: <strong>{scoring.goalGap >= 0 ? '+' : ''}{scoring.goalGap.toFixed(1)}</strong></p>
              <h3>Топ-3 фактора</h3>
              <ul>{scoring.explainTop3.map((item) => <li key={item.key}><strong>{item.title}:</strong> {item.textRu}</li>)}</ul>
              <h3>3 лучших действия</h3>
              <ol>{actions.map((item) => <li key={`${item.metricId}-${item.impulse}`}><strong>{item.titleRu}</strong> · Δцели {item.deltaGoalScore >= 0 ? '+' : ''}{item.deltaGoalScore.toFixed(1)} · Δиндекса {item.deltaIndex >= 0 ? '+' : ''}{item.deltaIndex.toFixed(2)} · ΔP(collapse) {(item.deltaPCollapse * 100).toFixed(1)} п.п.<br />{item.rationaleRu}</li>)}</ol>
              <button type="button" onClick={async () => {
                if (!selected.id || actions.length === 0) return
                const best = actions[0]
                await addQuest({
                  createdAt: Date.now(),
                  title: `Миссия цели: ${best.titleRu}`,
                  metricTarget: best.metricId,
                  delta: best.impulse,
                  horizonDays: 3,
                  status: 'active',
                  predictedIndexLift: Math.max(0.1, best.deltaIndex),
                  goalId: selected.id,
                })
                await addGoalEvent({ goalId: selected.id, goalScore: scoring.goalScore, goalGap: scoring.goalGap })
              }}>Принять как миссию на 3 дня</button>
            </>
          ) : <p>Нет данных для расчёта гравитации.</p>}
        </article>
      </div>
    </section>
  )
}
