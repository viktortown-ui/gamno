import { useEffect, useMemo, useState } from 'react'
import { INDEX_METRIC_IDS, METRICS, type MetricId } from '../core/metrics'
import type { CheckinRecord } from '../core/models/checkin'
import { addScenario, listCheckins, listScenarios, loadInfluenceMatrix } from '../core/storage/repo'
import { explainDriverInsights } from '../core/engines/influence/influence'
import type { InfluenceMatrix, MetricVector, OracleScenario } from '../core/engines/influence/types'
import { computeIndexDay } from '../core/engines/analytics/compute'
import { formatDateTime, formatNumber } from '../ui/format'
import { buildPlaybook, propagateBySteps } from '../core/engines/influence/oracle'

function toVector(base?: CheckinRecord): MetricVector | undefined {
  if (!base) return undefined
  return METRICS.reduce((acc, metric) => {
    acc[metric.id] = base[metric.id]
    return acc
  }, {} as MetricVector)
}

export function OraclePage({ latest }: { latest?: CheckinRecord }) {
  const [impulses, setImpulses] = useState<Partial<Record<MetricId, number>>>({})
  const [focusMetrics, setFocusMetrics] = useState<MetricId[]>(['energy', 'stress', 'sleepHours'])
  const [matrix, setMatrix] = useState<InfluenceMatrix | null>(null)
  const [saved, setSaved] = useState<OracleScenario[]>([])
  const [baselineTs, setBaselineTs] = useState<number | 'latest'>('latest')
  const [checkins, setCheckins] = useState<CheckinRecord[]>([])

  useEffect(() => {
    void loadInfluenceMatrix().then(setMatrix)
    void listScenarios().then(setSaved)
    void listCheckins().then(setCheckins)
  }, [])

  const baseline = useMemo(() => {
    if (baselineTs === 'latest') return latest
    return checkins.find((item) => item.ts === baselineTs) ?? latest
  }, [baselineTs, checkins, latest])

  const baseVector = useMemo(() => toVector(baseline), [baseline])
  const propagation = useMemo(() => (baseVector && matrix ? propagateBySteps(baseVector, impulses, matrix, 3) : undefined), [baseVector, impulses, matrix])
  const result = propagation?.[2]

  if (!latest || !baseVector || !matrix || !result || !baseline) return <section className="page"><h1>Оракул</h1><p>Нет базового чек-ина для сценариев.</p></section>

  const baseIndex = computeIndexDay(baseline)
  const resultRecord = { ...baseline, ...result }
  const scenarioIndex = computeIndexDay(resultRecord)
  const indexDelta = scenarioIndex - baseIndex
  const drivers = explainDriverInsights(result, baseVector, matrix, 5)
  const playbook = buildPlaybook(baseVector, result, matrix)

  const toggleMetric = (metricId: MetricId) => {
    setFocusMetrics((prev) => {
      if (prev.includes(metricId)) return prev.filter((id) => id !== metricId)
      if (prev.length >= 5) return prev
      return [...prev, metricId]
    })
  }

  return <section className="page">
    <h1>Оракул</h1>
    <p>Сначала задайте сценарий, потом смотрите последствия.</p>

    <div className="oracle-grid">
      <article className="summary-card">
        <h2>Базовая точка</h2>
        <label>Чек-ин
          <select value={baselineTs} onChange={(e) => setBaselineTs(e.target.value === 'latest' ? 'latest' : Number(e.target.value))}>
            <option value="latest">Последний</option>
            {checkins.map((row) => <option key={row.ts} value={row.ts}>{formatDateTime(row.ts)}</option>)}
          </select>
        </label>
        <p>Индекс базы: <strong>{formatNumber(baseIndex)}</strong></p>
      </article>

      <article className="summary-card">
        <h2>Конструктор сценария</h2>
        <p>Выберите 3-5 метрик.</p>
        <div className="metric-tags">{INDEX_METRIC_IDS.map((id) => {
          const m = METRICS.find((item) => item.id === id)!
          const active = focusMetrics.includes(id)
          return <button key={id} type="button" className={active ? 'filter-button filter-button--active' : 'filter-button'} onClick={() => toggleMetric(id)}>{m.labelRu}</button>
        })}</div>
        <div className="metric-cards">{focusMetrics.map((id) => {
          const m = METRICS.find((item) => item.id === id)!
          return <label key={id}>{m.labelRu} Δ<input type="number" value={impulses[id] ?? 0} onChange={(e) => setImpulses((p) => ({ ...p, [id]: Number(e.target.value) }))} /></label>
        })}</div>
      </article>

      <article className="summary-card">
        <h2>Результат</h2>
        <p>Новый индекс: <strong>{formatNumber(scenarioIndex)}</strong></p>
        <p>Δ индекса: <strong>{indexDelta > 0 ? '+' : ''}{formatNumber(indexDelta)}</strong></p>
        <ol>{propagation.map((vector, idx) => <li key={idx}>Шаг {idx + 1}: {METRICS.map((m) => `${m.labelRu} ${formatNumber(vector[m.id])}`).join(' | ')}</li>)}</ol>
      </article>
    </div>

    <div className="oracle-grid">
      <article className="summary-card">
        <h2>Почему так</h2>
        <ul>{drivers.map((driver) => <li key={`${driver.from}-${driver.to}`}>{driver.text} ({formatNumber(driver.strength)})</li>)}</ul>
      </article>

      <article className="summary-card">
        <h2>Плейбук</h2>
        <ol>{playbook.map((item) => <li key={item}>{item}</li>)}</ol>
      </article>

      <article className="summary-card">
        <h2>Сравнение базы и сценария</h2>
        <table className="table table--dense"><thead><tr><th>Метрика</th><th>База</th><th>Сценарий</th><th>Δ</th></tr></thead>
          <tbody>{METRICS.map((metric) => {
            const b = baseline[metric.id]
            const s = result[metric.id]
            return <tr key={metric.id}><td>{metric.labelRu}</td><td>{formatNumber(b)}</td><td>{formatNumber(s)}</td><td>{s - b > 0 ? '+' : ''}{formatNumber(s - b)}</td></tr>
          })}</tbody></table>
      </article>
    </div>

    <button type="button" onClick={async () => {
      const nameRu = window.prompt('Название сценария')
      if (!nameRu) return
      const scenario: OracleScenario = { ts: Date.now(), nameRu, baseTs: baseline.ts, impulses, result, index: scenarioIndex }
      await addScenario(scenario)
      setSaved(await listScenarios())
    }}>Сохранить сценарий</button>

    <h2>Сохраненные сценарии</h2>
    <ul>{saved.map((row) => <li key={`${row.ts}-${row.nameRu}`}>{row.nameRu}: {formatNumber(row.index)}</li>)}</ul>
  </section>
}
