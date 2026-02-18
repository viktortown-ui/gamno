import { useMemo, useState } from 'react'
import { INDEX_METRIC_IDS, METRICS } from '../core/metrics'
import type { CheckinRecord } from '../core/models/checkin'
import type { QuestRecord } from '../core/models/quest'
import {
  computeAverages,
  computeIndexSeries,
  computeStreak,
  computeVolatility,
  computeWindowDelta,
} from '../core/engines/analytics/compute'
import { evaluateSignals } from '../core/engines/rules/evaluateSignals'
import { forecastIndex } from '../core/engines/forecast/indexForecast'
import { formatNumber } from '../ui/format'
import { Sparkline } from '../ui/Sparkline'
import { buildCheckinResultInsight } from '../core/engines/engagement/suggestions'
import { defaultInfluenceMatrix } from '../core/engines/influence/influence'
import { addQuest, completeQuestById } from '../core/storage/repo'
import { createQuestFromSuggestion } from '../core/engines/engagement/quests'

export function DashboardPage({
  checkins,
  activeQuest,
  onQuestChange,
}: {
  checkins: CheckinRecord[]
  activeQuest?: QuestRecord
  onQuestChange: () => Promise<void>
}) {
  const [outcomeMessage, setOutcomeMessage] = useState<string>('')

  const analytics = useMemo(() => {
    const avg7 = computeAverages(checkins, INDEX_METRIC_IDS, 7)
    const delta7 = computeWindowDelta(checkins, INDEX_METRIC_IDS, 7)
    const indexSeries = computeIndexSeries(checkins)
    const current7 = indexSeries.slice(-7)
    const previous7 = indexSeries.slice(-14, -7)
    const indexAvg7 = current7.length ? current7.reduce((s, v) => s + v, 0) / current7.length : 0
    const prevIndexAvg7 = previous7.length ? previous7.reduce((s, v) => s + v, 0) / previous7.length : 0
    const signals = evaluateSignals({
      energyAvg7d: avg7.energy ?? 0,
      stressAvg7d: avg7.stress ?? 0,
      sleepAvg7d: avg7.sleepHours ?? 0,
      indexDelta7d: indexAvg7 - prevIndexAvg7,
    })
    const forecast = forecastIndex(indexSeries)

    return {
      avg7,
      delta7,
      indexAvg7,
      indexDelta7: indexAvg7 - prevIndexAvg7,
      streak: computeStreak(checkins),
      volatility: computeVolatility(checkins, 'energy', 14),
      signals,
      forecast,
      indexSeries,
    }
  }, [checkins])

  const suggestedQuest = useMemo(() => {
    if (!checkins.length) return null
    const insight = buildCheckinResultInsight(checkins[0], checkins[1], defaultInfluenceMatrix)
    return insight.bestLever ? createQuestFromSuggestion(insight.bestLever) : null
  }, [checkins])

  if (checkins.length < 3) {
    return <section className="page"><h1>Дашборд</h1><p>Добавьте минимум 3 чек-ина для аналитики.</p><a href="#/core">Сделать чек-ин</a></section>
  }

  const volatilityLabel = analytics.volatility < 0.8 ? 'низкая' : analytics.volatility < 1.6 ? 'средняя' : 'высокая'

  return (
    <section className="page">
      <h1>Дашборд</h1>
      <p>Серия: <strong className="mono">{analytics.streak}</strong> дн.</p>

      <article className="summary-card panel">
        <h2>Следующее действие</h2>
        {activeQuest ? (
          <>
            <p><strong>{activeQuest.title}</strong></p>
            <p>Ожидаемый рост индекса: <strong className="mono">+{formatNumber(activeQuest.predictedIndexLift)}</strong></p>
            <button type="button" onClick={async () => {
              if (!activeQuest.id) return
              const completed = await completeQuestById(activeQuest.id)
              setOutcomeMessage(completed ? `${completed.outcomeRu} +${completed.xpEarned} XP` : '')
              await onQuestChange()
            }}>Отметить выполненным</button>
          </>
        ) : (
          <>
            <p>{suggestedQuest?.title ?? 'Пока нет предложения'}</p>
            <p>{suggestedQuest ? <>Ожидаемый рост индекса: <strong className="mono">+{formatNumber(suggestedQuest.predictedIndexLift)}</strong></> : 'Добавьте данные для подсказки.'}</p>
            <button type="button" disabled={!suggestedQuest} onClick={async () => {
              if (!suggestedQuest) return
              await addQuest(suggestedQuest)
              await onQuestChange()
            }}>Принять действие</button>
          </>
        )}
        {outcomeMessage ? <p className="chip">{outcomeMessage}</p> : null}
      </article>

      <div className="metric-cards">
        {METRICS.filter((m) => m.id !== 'cashFlow').map((metric) => {
          const metricSeries = checkins.slice(0, 14).reverse().map((r) => r[metric.id])
          const delta = analytics.delta7[metric.id] ?? 0
          return (
            <article className="metric-card" key={metric.id}>
              <h3>{metric.labelRu}</h3>
              <p><span className="mono">{formatNumber(analytics.avg7[metric.id] ?? 0)}</span> ({delta > 0 ? '↑' : delta < 0 ? '↓' : '→'} <span className="mono">{formatNumber(delta)}</span>)</p>
              <Sparkline values={metricSeries} />
            </article>
          )
        })}
      </div>

      <h2>Сигналы</h2>
      <ul className="signals-list">
        {analytics.signals.length ? analytics.signals.map((signal) => (
          <li className={`signal signal--${signal.severity}`} key={signal.id}>
            <strong>{signal.titleRu}</strong>
            <p>{signal.descriptionRu}</p>
            <ul>{signal.actionsRu.map((a) => <li key={a}>{a}</li>)}</ul>
          </li>
        )) : <li>Сигналы не обнаружены.</li>}
      </ul>

      <h2>Прогноз (7 дней)</h2>
      <p>Прогноз — это экстраполяция тренда, не гарантия.</p>
      <p>Уверенность: {analytics.forecast.confidence === 'high' ? 'высокая' : analytics.forecast.confidence === 'med' ? 'средняя' : 'низкая'}</p>
      <ol>{analytics.forecast.values.map((v, i) => <li key={i}>{formatNumber(v)}</li>)}</ol>

      <div className="cockpit-strip">
        <article>
          <span>Индекс (7д)</span>
          <strong className="mono">{formatNumber(analytics.indexAvg7)}</strong>
          <div className="meter" aria-hidden="true"><div className="meter__fill" style={{ width: `${Math.max(0, Math.min(100, analytics.indexAvg7 * 10))}%` }} /></div>
        </article>
        <article>
          <span>Δ к прошлым 7д</span>
          <strong className="mono">{analytics.indexDelta7 > 0 ? '+' : ''}{formatNumber(analytics.indexDelta7)}</strong>
          <span className={`status-badge ${analytics.indexDelta7 >= 0 ? 'status-badge--low' : 'status-badge--high'}`}>{analytics.indexDelta7 >= 0 ? 'рост' : 'спад'}</span>
        </article>
        <article>
          <span>Сигналы</span>
          <strong className="mono">{analytics.signals.length}</strong>
          <span className={`status-badge ${analytics.signals.length >= 3 ? 'status-badge--high' : analytics.signals.length > 0 ? 'status-badge--mid' : 'status-badge--low'}`}>{analytics.signals.length >= 3 ? 'критично' : analytics.signals.length > 0 ? 'внимание' : 'чисто'}</span>
        </article>
        <article>
          <span>Прогноз 7д</span>
          <strong className="mono">{formatNumber(analytics.forecast.values[analytics.forecast.values.length - 1] ?? analytics.indexAvg7)}</strong>
          <div className="meter" aria-hidden="true"><div className="meter__fill meter__fill--alt" style={{ width: `${Math.max(0, Math.min(100, (analytics.forecast.values[analytics.forecast.values.length - 1] ?? analytics.indexAvg7) * 10))}%` }} /></div>
        </article>
        <article><span>Волатильность</span><strong className={`volatility volatility--${volatilityLabel}`}>{volatilityLabel}</strong></article>
      </div>
    </section>
  )
}
