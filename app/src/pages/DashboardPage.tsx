import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { INDEX_METRIC_IDS, METRICS, type MetricId } from '../core/metrics'
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
import { formatDateTime, formatNumber } from '../ui/format'
import { Sparkline } from '../ui/Sparkline'
import { buildCheckinResultInsight } from '../core/engines/engagement/suggestions'
import { computeTopLevers, defaultInfluenceMatrix } from '../core/engines/influence/influence'
import { saveOracleScenarioDraft } from '../core/engines/influence/scenarioDraft'
import { addQuest, completeQuestById, seedTestData } from '../core/storage/repo'
import { getLatestForecastRun } from '../repo/forecastRepo'
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
  const navigate = useNavigate()
  const [outcomeMessage, setOutcomeMessage] = useState<string>('')
  const [forecastTile, setForecastTile] = useState<{ p50: number; confidence: string } | null>(null)

  useEffect(() => {
    void getLatestForecastRun().then((run) => {
      if (!run) return
      const coverage = run.backtest.coverage
      const confidence = coverage >= 75 ? 'высокая' : coverage >= 60 ? 'средняя' : 'низкая'
      setForecastTile({ p50: run.index.p50[6] ?? run.index.p50.at(-1) ?? 0, confidence })
    })
  }, [])

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

  const topLevers = useMemo(() => {
    const baseline = checkins[0]
    if (!baseline) return []
    return computeTopLevers(baseline, defaultInfluenceMatrix, 3)
  }, [checkins])

  const applyLeverAsScenario = (
    from: MetricId,
    to: MetricId,
    suggestedDelta: number,
    sourceLabelRu?: string,
  ) => {
    saveOracleScenarioDraft({
      baselineTs: 'latest',
      impulses: { [from]: suggestedDelta },
      focusMetrics: [from, to],
      sourceLabelRu,
    })
    navigate('/oracle?prefill=1')
  }

  if (checkins.length < 3) {
    return (
      <section className="page">
        <h1>Дашборд</h1>
        <article className="empty-state panel">
          <h2>Пуск</h2>
          <p>60 секунд до первых инсайтов.</p>
          <ol>
            <li>Сделайте чек-ин и зафиксируйте базу.</li>
            <li>Запустите сценарий и оцените рычаги.</li>
            <li>Примите миссию на 3 дня и отслеживайте прогресс.</li>
          </ol>
          <div className="settings-actions">
            <button type="button" onClick={() => navigate('/core')}>Сделать чек-ин</button>
            <button type="button" onClick={async () => { await seedTestData(30, 42); navigate('/dashboard') }}>Сгенерировать тестовые данные (30 дней)</button>
            <button type="button" onClick={() => navigate('/settings')}>Импортировать хранилище</button>
          </div>
        </article>
      </section>
    )
  }

  const volatilityLabel = analytics.volatility < 0.8 ? 'низкая' : analytics.volatility < 1.6 ? 'средняя' : 'высокая'

  return (
    <section className="page">
      <h1>Дашборд</h1>
      <p>Серия: <strong className="mono">{analytics.streak}</strong> дн.</p>

      <article className="summary-card panel">
        <h2>Прогноз/Уверенность</h2>
        <p>Прогноз p50 (7д): <strong className="mono">{formatNumber(forecastTile?.p50 ?? analytics.forecast.values.at(-1) ?? 0)}</strong></p>
        <p>Уверенность: <span className="status-badge status-badge--mid">{forecastTile?.confidence ?? 'нет данных'}</span></p>
        <button type="button" onClick={() => navigate('/oracle')}>Перейти к пересчёту в Оракуле</button>
      </article>

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

      <h2>Авто-рычаги (топ-3)</h2>
      <div className="metric-cards">
        {topLevers.map((lever) => {
          const fromLabel = METRICS.find((item) => item.id === lever.from)?.labelRu ?? lever.from
          const toLabel = METRICS.find((item) => item.id === lever.to)?.labelRu ?? lever.to
          return (
            <article className="metric-card" key={`${lever.from}-${lever.to}`}>
              <h3>{fromLabel} → {toLabel}</h3>
              <p>Вес связи: <strong className="mono">{lever.weight > 0 ? '+' : ''}{formatNumber(lever.weight)}</strong></p>
              <p>Рекомендуемый импульс: <strong className="mono">{lever.suggestedDelta > 0 ? '+' : ''}{formatNumber(lever.suggestedDelta)}</strong></p>
              <p>Ожидаемый Δ индекса: <strong className="mono">+{formatNumber(lever.expectedIndexDelta)}</strong></p>
              <button
                type="button"
                onClick={() => applyLeverAsScenario(lever.from, lever.to, lever.suggestedDelta, `Авто-рычаг ${fromLabel} → ${toLabel} (${formatDateTime(Date.now())})`)}
              >
                Применить импульс
              </button>
            </article>
          )
        })}
      </div>

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
