import { useMemo } from 'react'
import { INDEX_METRIC_IDS, METRICS } from '../core/metrics'
import type { CheckinRecord } from '../core/models/checkin'
import {
  computeAverages,
  computeDelta,
  computeIndexTrend,
  computeStreak,
  getRange,
} from '../core/engines/analytics/compute'
import { evaluateSignals } from '../core/engines/analytics/rules'
import { formatNumber } from '../ui/format'

export function DashboardPage({ checkins }: { checkins: CheckinRecord[] }) {
  const summary = useMemo(() => {
    const sorted = [...checkins].sort((a, b) => b.ts - a.ts)
    const last7 = getRange(sorted, 7)
    const prev7From = Date.now() - 14 * 24 * 60 * 60 * 1000
    const currentFrom = Date.now() - 7 * 24 * 60 * 60 * 1000
    const prev7 = sorted.filter((item) => item.ts >= prev7From && item.ts < currentFrom)
    const currentAvg = computeAverages(last7, INDEX_METRIC_IDS)
    const previousAvg = computeAverages(prev7, INDEX_METRIC_IDS)
    const delta = computeDelta(currentAvg, previousAvg)
    const trend = computeIndexTrend(sorted)
    const streak = computeStreak(sorted)
    const signals = evaluateSignals(sorted)

    return {
      trend,
      streak,
      currentAvg,
      delta,
      signals,
      hasEnoughData: sorted.length >= 2,
    }
  }, [checkins])

  if (!summary.hasEnoughData) {
    return (
      <section className="page">
        <h1>Дашборд</h1>
        <p>Недостаточно данных для аналитики. Сохраните минимум два чек-ина, чтобы увидеть динамику за 7 дней.</p>
      </section>
    )
  }

  return (
    <section className="page">
      <h1>Дашборд</h1>

      <section className="summary-grid">
        <article className="summary-card">
          <h2>Сводка 7 дней</h2>
          <p>Индекс: <strong>{formatNumber(summary.trend.currentAvg)}</strong></p>
          <p>
            Тренд: {summary.trend.direction === 'up' ? '↑' : summary.trend.direction === 'down' ? '↓' : '→'}
            {' '}Δ {summary.trend.delta > 0 ? '+' : ''}{formatNumber(summary.trend.delta)}
          </p>
          <p>Серия дней подряд: <strong>{summary.streak}</strong></p>
        </article>
      </section>

      <section>
        <h2>Метрики</h2>
        <div className="metric-cards">
          {METRICS.filter((metric) => metric.id !== 'cashFlow').map((metric) => {
            const delta = summary.delta[metric.id] ?? 0
            const direction = delta > 0 ? '↑' : delta < 0 ? '↓' : '→'
            return (
              <article className="metric-card" key={metric.id}>
                <h3>{metric.labelRu}</h3>
                <p>Среднее 7 дн.: <strong>{formatNumber(summary.currentAvg[metric.id] ?? 0)}</strong></p>
                <p>Δ: {delta > 0 ? '+' : ''}{formatNumber(delta)} {direction}</p>
              </article>
            )
          })}
        </div>
      </section>

      <section>
        <h2>Сигналы</h2>
        {summary.signals.length === 0 ? (
          <p>Сейчас сигналы не обнаружены.</p>
        ) : (
          <ul className="signals-list">
            {summary.signals.map((signal) => (
              <li key={signal.titleRu} className={`signal signal--${signal.severity}`}>
                <h3>{signal.titleRu}</h3>
                <p>{signal.descriptionRu}</p>
                <ul>
                  {signal.suggestedActionsRu.map((action) => (
                    <li key={action}>{action}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  )
}
