import { useEffect, useMemo, useState } from 'react'
import { addQuest, getActiveGoal } from '../core/storage/repo'
import { computeAndSaveSnapshot, getLastSnapshot, listSnapshots } from '../repo/timeDebtRepo'
import type { TimeDebtSnapshotRecord } from '../core/models/timeDebt'

export function TimeDebtPage({ onQuestChange }: { onQuestChange: () => Promise<void> }) {
  const [snapshot, setSnapshot] = useState<TimeDebtSnapshotRecord | null>(null)
  const [history, setHistory] = useState<TimeDebtSnapshotRecord[]>([])
  const [goalId, setGoalId] = useState<number | undefined>()

  const load = async () => {
    const [last, rows, goal] = await Promise.all([
      getLastSnapshot(),
      listSnapshots({ limit: 14 }),
      getActiveGoal(),
    ])
    setSnapshot(last ?? await computeAndSaveSnapshot({}))
    setHistory(rows)
    setGoalId(goal?.id)
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  const bars = useMemo(() => {
    if (!snapshot) return []
    return [
      { key: 'sleepDebt', label: 'Сон', value: snapshot.debts.sleepDebt },
      { key: 'recoveryDebt', label: 'Восстановление', value: snapshot.debts.recoveryDebt },
      { key: 'focusDebt', label: 'Фокус', value: snapshot.debts.focusDebt },
      { key: 'socialDebt', label: 'Соц. ресурс', value: snapshot.debts.socialDebt ?? 0 },
    ]
  }, [snapshot])

  if (!snapshot) return <section className="page"><h1>Долг</h1><p>Загрузка…</p></section>

  return (
    <section className="page">
      <h1>Долг</h1>
      <div className="oracle-grid">
        <article className="summary-card panel">
          <h2>Total Debt</h2>
          <p><strong>{snapshot.totals.totalDebt.toFixed(2)}</strong> · Индекс долга: <strong>{snapshot.totals.debtIndex.toFixed(1)}</strong></p>
          <p>Тренд: <strong>{snapshot.totals.debtTrend === 'up' ? 'растёт' : snapshot.totals.debtTrend === 'down' ? 'снижается' : 'стабилен'}</strong></p>
          <ul>
            {bars.map((item) => <li key={item.key}>{item.label}: <strong>{item.value.toFixed(2)}</strong><div className="meter"><div className="meter__fill" style={{ width: `${Math.min(100, item.value * 12)}%` }} /></div></li>)}
          </ul>
        </article>

        <article className="summary-card panel">
          <h2>Почему долг такой</h2>
          <ul>
            {snapshot.explainTop3.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </article>

        <article className="summary-card panel">
          <h2>Протокол погашения</h2>
          <ol>
            {snapshot.protocolActions.slice(0, 3).map((action) => (
              <li key={action.actionId}>
                <strong>{action.titleRu}</strong> — {action.reasonRu}
                <br />Δиндекс {action.effect.deltaIndex >= 0 ? '+' : ''}{action.effect.deltaIndex.toFixed(2)} · ΔP(collapse) {(action.effect.deltaPCollapse * 100).toFixed(2)} п.п. · Δgoal {action.effect.deltaGoalScore >= 0 ? '+' : ''}{action.effect.deltaGoalScore.toFixed(2)}
              </li>
            ))}
          </ol>
          <div className="settings-actions">
            <button type="button" onClick={async () => {
              const first = snapshot.protocolActions[0]
              if (!first) return
              await addQuest({ createdAt: Date.now(), title: `Долг: ${first.titleRu}`, metricTarget: first.domain, delta: -1, horizonDays: 3, status: 'active', predictedIndexLift: Math.max(0.3, snapshot.effectEstimate.deltaIndex), goalId })
              await computeAndSaveSnapshot({})
              await onQuestChange()
              await load()
            }}>Принять как миссию на 3 дня</button>
            <button type="button" onClick={async () => {
              await addQuest({ createdAt: Date.now(), title: 'Долг: частичное погашение', metricTarget: 'recovery', delta: -0.5, horizonDays: 1, status: 'completed', predictedIndexLift: 0.2, completedAt: Date.now(), outcomeRu: 'Частичное выполнение протокола', goalId })
              await computeAndSaveSnapshot({})
              await onQuestChange()
              await load()
            }}>Отметить частичное выполнение</button>
          </div>
        </article>
      </div>

      <article className="summary-card panel">
        <h2>История долга (14 дней)</h2>
        <table className="table">
          <thead><tr><th>День</th><th>Total</th><th>Сон</th><th>Восстановление</th><th>Фокус</th></tr></thead>
          <tbody>
            {history.map((row) => <tr key={row.id ?? row.ts}><td>{row.dayKey}</td><td>{row.totals.totalDebt.toFixed(2)}</td><td>{row.debts.sleepDebt.toFixed(2)}</td><td>{row.debts.recoveryDebt.toFixed(2)}</td><td>{row.debts.focusDebt.toFixed(2)}</td></tr>)}
          </tbody>
        </table>
      </article>
    </section>
  )
}
