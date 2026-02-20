import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { addQuest } from '../core/storage/repo'
import { computeAntifragility, type AntifragilityDayInput } from '../core/engines/antifragility'
import { createShockSession, computeAndSaveSnapshot, getLastSnapshot, listShockSessions, listSnapshots } from '../repo/antifragilityRepo'
import { db } from '../core/storage/db'

function trendArrow(value: 'up' | 'down' | 'flat'): string {
  if (value === 'up') return '↑'
  if (value === 'down') return '↓'
  return '→'
}

export function AntifragilityPage({ onQuestChange }: { onQuestChange: () => Promise<void> }) {
  const navigate = useNavigate()
  const [computed, setComputed] = useState<ReturnType<typeof computeAntifragility> | null>(null)
  const [history, setHistory] = useState<Awaited<ReturnType<typeof listSnapshots>>>([])
  const [sessions, setSessions] = useState<Awaited<ReturnType<typeof listShockSessions>>>([])

  const load = async () => {
    const [stateSnapshots, regimeSnapshots, debtSnapshots, shocks, tailRisk, savedHistory, latest] = await Promise.all([
      db.stateSnapshots.orderBy('ts').toArray(),
      db.regimeSnapshots.orderBy('ts').toArray(),
      db.timeDebtSnapshots.orderBy('ts').toArray(),
      listShockSessions(50),
      db.blackSwanRuns.orderBy('ts').last(),
      listSnapshots(14),
      getLastSnapshot(),
    ])

    const regimeByDay = new Map(regimeSnapshots.map((item) => [item.dayKey, item]))
    const debtByDay = new Map(debtSnapshots.map((item) => [item.dayKey, item]))
    const series: AntifragilityDayInput[] = stateSnapshots.map((state) => {
      const dayKey = new Date(state.ts).toISOString().slice(0, 10)
      const regime = regimeByDay.get(dayKey)
      const debt = debtByDay.get(dayKey)
      return {
        dayKey,
        index: state.index,
        pCollapse: regime?.pCollapse ?? 0,
        sirenLevel: regime?.sirenLevel ?? 'green',
        volatility: state.volatility,
        entropy: state.entropy,
        drift: state.drift,
        timeDebtTotal: debt?.totals.totalDebt ?? 0,
        regimeId: regime?.regimeId ?? 0,
      }
    })
    const result = computeAntifragility({ series, sessions: shocks, tailRisk: tailRisk?.summary.esCollapse10 ?? 0 })
    setComputed(result)
    setHistory(savedHistory)
    setSessions(shocks)

    if (!latest && series.length) {
      await computeAndSaveSnapshot({})
      setHistory(await listSnapshots(14))
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  const trend = useMemo(() => {
    if (history.length < 2) return 'flat'
    if (history[0].recoveryScore > history[1].recoveryScore + 1) return 'up'
    if (history[0].recoveryScore < history[1].recoveryScore - 1) return 'down'
    return 'flat'
  }, [history])

  const latestHistory = history[0]

  return (
    <section className="page panel">
      <h1>Антихрупкость</h1>
      <p>Слой оценивает скорость восстановления и включает только безопасные контролируемые встряски.</p>
      <div className="dashboard-grid">
        <article className="summary-card panel">
          <h2>Восстановление</h2>
          <p><strong>{computed?.recoveryScore.toFixed(1) ?? '0.0'}</strong> / 100 {trendArrow(trend)}</p>
        </article>
        <article className="summary-card panel">
          <h2>Бюджет встрясок</h2>
          <p><strong>{computed?.shockBudget ?? 0}</strong> в неделю</p>
        </article>
        <article className="summary-card panel">
          <h2>Антихрупкость</h2>
          <p><strong>{computed?.antifragilityScore.toFixed(1) ?? '0.0'}</strong> / 100</p>
          <ol>{computed?.explainTop3.map((line) => <li key={line}>{line}</li>)}</ol>
        </article>
        <article className="summary-card panel">
          <h2>Режим безопасности</h2>
          <p><strong>{computed?.safetyModeRu ?? 'Только восстановление'}</strong></p>
          {!computed?.allowShocks ? <button type="button" onClick={() => navigate('/time-debt')}>Открыть протокол долга</button> : null}
        </article>
      </div>

      <article className="summary-card panel">
        <h2>Предложения</h2>
        {computed?.suggestions.length ? (
          <ul>
            {computed.suggestions.map((item) => (
              <li key={`${item.type}-${item.titleRu}`}>
                <strong>{item.titleRu}</strong> · {item.durationMin} мин · интенсивность {item.intensity}
                <p>{item.whyRu}</p>
                <p>Ожидаемый эффект: {item.expectedEffect}</p>
                <p>{item.safetyNoteRu}</p>
                <div className="settings-actions">
                  <button type="button" onClick={async () => {
                    const quest = await addQuest({ createdAt: Date.now(), title: `Антихрупкость: ${item.titleRu}`, metricTarget: 'stress', delta: -0.5, horizonDays: 3, status: 'active', predictedIndexLift: 0.6, shockType: item.type })
                    await createShockSession({ type: item.type, intensity: item.intensity, plannedDurationMin: item.durationMin, status: 'planned', links: { questId: quest.id } })
                    await computeAndSaveSnapshot({ afterQuestId: quest.id })
                    await onQuestChange()
                    await load()
                  }}>Принять как миссию на 3 дня</button>
                  <button type="button" onClick={async () => {
                    await createShockSession({ type: item.type, intensity: item.intensity, plannedDurationMin: item.durationMin, status: 'planned', links: {} })
                    await computeAndSaveSnapshot({})
                    await load()
                  }}>Запланировать</button>
                </div>
              </li>
            ))}
          </ul>
        ) : <p>Сейчас доступны только восстановительные шаги без встрясок.</p>}
      </article>

      <article className="summary-card panel">
        <h2>История (14 дней)</h2>
        <table>
          <thead><tr><th>День</th><th>Recovery</th><th>Бюджет</th><th>Антихрупкость</th><th>Сессии</th></tr></thead>
          <tbody>
            {history.map((item) => (
              <tr key={item.id}>
                <td>{item.dayKey}</td>
                <td>{item.recoveryScore.toFixed(1)}</td>
                <td>{item.shockBudget}</td>
                <td>{item.antifragilityScore.toFixed(1)}</td>
                <td>{sessions.filter((s) => s.dayKey === item.dayKey).length}</td>
              </tr>
            ))}
            {!history.length ? <tr><td colSpan={5}>Данные ещё не сформированы.</td></tr> : null}
          </tbody>
        </table>
      </article>

      {latestHistory ? <p>Последний снимок: {new Date(latestHistory.ts).toLocaleString('ru-RU')}</p> : null}
    </section>
  )
}
