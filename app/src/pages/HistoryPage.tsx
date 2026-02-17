import { useMemo, useState } from 'react'
import { METRICS, type MetricId } from '../core/metrics'
import type { CheckinRecord, CheckinValues } from '../core/models/checkin'
import { computeIndexDay } from '../core/engines/analytics/compute'
import { deleteCheckin } from '../core/storage/repo'
import { formatDateTime, formatMetricValue, formatNumber } from '../ui/format'

const columnOrder: MetricId[] = ['energy', 'focus', 'mood', 'stress', 'sleepHours', 'productivity', 'cashFlow']

export function HistoryPage({ checkins, onUseTemplate, onDataChanged }: { checkins: CheckinRecord[]; onUseTemplate: (v: CheckinValues) => void; onDataChanged: () => Promise<void> }) {
  const [days, setDays] = useState<7 | 30 | 90>(30)
  const [selectedId, setSelectedId] = useState<number | undefined>()
  const [nowTs] = useState(() => Date.now())

  const filtered = useMemo(() => checkins
    .filter((item) => item.ts >= nowTs - days * 86400000)
    .sort((a, b) => b.ts - a.ts), [checkins, days, nowTs])

  const selectedIndex = filtered.findIndex((row) => row.id === selectedId)
  const selected = selectedIndex >= 0 ? filtered[selectedIndex] : undefined
  const prev = selectedIndex >= 0 ? filtered[selectedIndex + 1] : undefined

  return <section className="page">
    <h1>История</h1>
    <div className="filters">{([7, 30, 90] as const).map((d) => <button key={d} type="button" className={`filter-button ${days === d ? 'filter-button--active' : ''}`} onClick={() => setDays(d)}>{d} дней</button>)}</div>
    <table className="table table--dense"><thead><tr><th>Дата/время</th><th>Индекс</th><th>Энергия</th><th>Фокус</th><th>Настроение</th><th>Стресс</th><th>Сон</th><th>Продуктивность</th><th>Денежный поток</th></tr></thead>
      <tbody>{filtered.map((item) => <tr key={item.id} tabIndex={0} onClick={() => setSelectedId(item.id)} onKeyDown={(e) => e.key === 'Enter' && setSelectedId(item.id)}><td>{formatDateTime(item.ts)}</td><td>{formatNumber(computeIndexDay(item))}</td><td>{item.energy}</td><td>{item.focus}</td><td>{item.mood}</td><td>{item.stress}</td><td>{item.sleepHours}</td><td>{item.productivity}</td><td>{formatMetricValue(METRICS.find((m) => m.id === 'cashFlow')!, item.cashFlow)}</td></tr>)}</tbody>
    </table>

    {selected && <section className="details-panel" onKeyDown={(e) => e.key === 'Escape' && setSelectedId(undefined)} tabIndex={0}>
      <h2>Детали записи</h2>
      <p>{formatDateTime(selected.ts)}</p>
      <ul>{columnOrder.map((id) => {
        const metric = METRICS.find((m) => m.id === id)!
        const delta = prev ? selected[id] - prev[id] : 0
        return <li key={id}>{metric.labelRu}: {formatMetricValue(metric, selected[id])} | Δ {delta > 0 ? '+' : ''}{formatNumber(delta)}</li>
      })}</ul>
      <button type="button" onClick={() => onUseTemplate({ energy: selected.energy, focus: selected.focus, mood: selected.mood, stress: selected.stress, sleepHours: selected.sleepHours, social: selected.social, productivity: selected.productivity, health: selected.health, cashFlow: selected.cashFlow })}>Использовать как шаблон</button>
      {selected.id && <button type="button" onClick={async () => {
        if (!window.confirm('Удалить запись?')) return
        const id = selected.id
        if (!id) return
        await deleteCheckin(id)
        await onDataChanged()
        setSelectedId(undefined)
      }}>Удалить запись</button>}
    </section>}
  </section>
}
