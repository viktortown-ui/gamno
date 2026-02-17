import { useMemo, useState } from 'react'
import { INDEX_METRIC_IDS, METRICS, type MetricId } from '../core/metrics'
import type { CheckinRecord, CheckinValues } from '../core/models/checkin'
import { computeIndexDay } from '../core/engines/analytics/compute'
import { formatDateTime, formatMetricValue, formatNumber, getMetricConfig } from '../ui/format'

export function HistoryPage({
  checkins,
  onUseTemplate,
}: {
  checkins: CheckinRecord[]
  onUseTemplate: (values: CheckinValues) => void
}) {
  const [days, setDays] = useState<7 | 30 | 90>(30)
  const [selectedId, setSelectedId] = useState<number | undefined>()

  const filtered = useMemo(() => {
    const fromTs = Date.now() - days * 24 * 60 * 60 * 1000
    return checkins.filter((item) => item.ts >= fromTs).sort((a, b) => b.ts - a.ts)
  }, [checkins, days])

  const selected = filtered.find((item) => item.id === selectedId)
  const selectedPrev = selected ? filtered.find((item) => item.ts < selected.ts) : undefined

  return (
    <section className="page">
      <h1>История</h1>
      <div className="filters">
        {[7, 30, 90].map((value) => (
          <button
            key={value}
            type="button"
            className={`filter-button ${days === value ? 'filter-button--active' : ''}`}
            onClick={() => setDays(value as 7 | 30 | 90)}
          >
            {value} дней
          </button>
        ))}
      </div>

      <table className="table table--dense">
        <thead>
          <tr>
            <th>Дата и время</th>
            <th>Индекс</th>
            <th>Энергия</th>
            <th>Фокус</th>
            <th>Настроение</th>
            <th>Стресс</th>
            <th>Денежный поток</th>
            <th>Действие</th>
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 ? (
            <tr>
              <td colSpan={8}>Нет записей за выбранный период.</td>
            </tr>
          ) : (
            filtered.map((item) => (
              <tr key={item.id}>
                <td>{formatDateTime(item.ts)}</td>
                <td>{formatNumber(computeIndexDay(item))}</td>
                <td>{item.energy}</td>
                <td>{item.focus}</td>
                <td>{item.mood}</td>
                <td>{item.stress}</td>
                <td>{formatMetricValue(getMetricConfig('cashFlow'), item.cashFlow)}</td>
                <td>
                  <button type="button" onClick={() => setSelectedId(item.id)}>
                    Открыть
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {selected ? (
        <section className="details-panel">
          <h2>Детали записи</h2>
          <p>{formatDateTime(selected.ts)}</p>
          <p>Индекс: <strong>{formatNumber(computeIndexDay(selected))}</strong></p>
          <ul>
            {METRICS.map((metric) => {
              const delta = selectedPrev ? selected[metric.id] - selectedPrev[metric.id] : 0
              return (
                <li key={metric.id}>
                  {metric.labelRu}: {formatMetricValue(metric, selected[metric.id])}
                  {' '}| Δ {delta > 0 ? '+' : ''}{formatNumber(delta)}
                </li>
              )
            })}
          </ul>
          <button
            type="button"
            onClick={() => {
              const template = INDEX_METRIC_IDS.concat('cashFlow' as MetricId).reduce<CheckinValues>((acc, id) => {
                acc[id] = selected[id]
                return acc
              }, {} as CheckinValues)
              onUseTemplate(template)
            }}
          >
            Сделать как шаблон
          </button>
        </section>
      ) : null}
    </section>
  )
}
