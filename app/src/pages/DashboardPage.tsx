import { useMemo } from 'react'
import { INDEX_METRIC_IDS, METRICS } from '../core/metrics'
import type { CheckinRecord } from '../core/models/checkin'
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

export function DashboardPage({ checkins }: { checkins: CheckinRecord[] }) {
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

  if (checkins.length < 3) {
    return <section className="page"><h1>Дашборд</h1><p>Добавьте минимум 3 чек-ина для аналитики.</p><a href="#/core">Сделать чек-ин</a></section>
  }

  const volatilityLabel = analytics.volatility < 0.8 ? 'низкая' : analytics.volatility < 1.6 ? 'средняя' : 'высокая'

  return (
    <section className="page">
      <h1>Дашборд</h1>
      <div className="cockpit-strip">
        <article><span>Индекс (7д)</span><strong>{formatNumber(analytics.indexAvg7)}</strong></article>
        <article><span>Δ к прошлым 7д</span><strong>{analytics.indexDelta7 > 0 ? '+' : ''}{formatNumber(analytics.indexDelta7)}</strong></article>
        <article><span>Сигналы</span><strong>{analytics.signals.length}</strong></article>
        <article><span>Прогноз next7</span><strong>{formatNumber(analytics.forecast.values[analytics.forecast.values.length - 1] ?? analytics.indexAvg7)}</strong></article>
        <article><span>Волатильность</span><strong className={`volatility volatility--${volatilityLabel}`}>{volatilityLabel}</strong></article>
      </div>

      <div className="metric-cards">
        {METRICS.filter((m) => m.id !== 'cashFlow').map((metric) => {
          const metricSeries = checkins.slice(0, 14).reverse().map((r) => r[metric.id])
          const delta = analytics.delta7[metric.id] ?? 0
          return (
            <article className="metric-card" key={metric.id}>
              <h3>{metric.labelRu}</h3>
              <p>{formatNumber(analytics.avg7[metric.id] ?? 0)} ({delta > 0 ? '↑' : delta < 0 ? '↓' : '→'} {formatNumber(delta)})</p>
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
    </section>
  )
}
