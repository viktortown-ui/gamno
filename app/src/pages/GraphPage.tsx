import { useEffect, useState } from 'react'
import { METRICS, type MetricId } from '../core/metrics'
import { applyImpulse, defaultInfluenceMatrix } from '../core/engines/influence/influence'
import type { InfluenceMatrix, MetricVector } from '../core/engines/influence/types'
import { loadInfluenceMatrix, resetInfluenceMatrix, saveInfluenceMatrix } from '../core/storage/repo'

export function GraphPage() {
  const [matrix, setMatrix] = useState<InfluenceMatrix>(defaultInfluenceMatrix)
  const [impulseMetric, setImpulseMetric] = useState<MetricId>('sleepHours')
  const [delta, setDelta] = useState(1)
  const [steps, setSteps] = useState<1 | 2 | 3>(2)
  const [testResult, setTestResult] = useState<MetricVector | null>(null)

  useEffect(() => { void loadInfluenceMatrix().then(setMatrix) }, [])

  const metricIds = METRICS.map((m) => m.id)

  return <section className="page">
    <h1>Граф влияний</h1>
    <table className="table table--dense"><thead><tr><th>От \ К</th>{metricIds.map((id) => <th key={id}>{METRICS.find((m) => m.id === id)?.labelRu}</th>)}</tr></thead>
      <tbody>{metricIds.map((fromId) => <tr key={fromId}><td>{METRICS.find((m) => m.id === fromId)?.labelRu}</td>{metricIds.map((toId) => <td key={toId}><input type="range" min={-1} max={1} step={0.1} value={matrix[fromId]?.[toId] ?? 0} onChange={(e) => {
        const next = Number(e.target.value)
        setMatrix((prev) => ({ ...prev, [fromId]: { ...prev[fromId], [toId]: next } }))
      }} /></td>)}</tr>)}</tbody></table>

    <button type="button" onClick={() => saveInfluenceMatrix(matrix)}>Сохранить карту</button>
    <button type="button" onClick={async () => { await resetInfluenceMatrix(); setMatrix(await loadInfluenceMatrix()) }}>Сброс к умолчанию</button>

    <h2>Тест импульса</h2>
    <label>Метрика<select value={impulseMetric} onChange={(e) => setImpulseMetric(e.target.value as MetricId)}>{metricIds.map((id) => <option key={id} value={id}>{METRICS.find((m) => m.id === id)?.labelRu}</option>)}</select></label>
    <label>Δ<input type="number" value={delta} onChange={(e) => setDelta(Number(e.target.value))} /></label>
    <label>Шаги<select value={steps} onChange={(e) => setSteps(Number(e.target.value) as 1 | 2 | 3)}>{[1,2,3].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
    <button type="button" onClick={() => {
      const base = metricIds.reduce((acc, id) => ({ ...acc, [id]: 5 }), {} as MetricVector)
      base.cashFlow = 0
      setTestResult(applyImpulse(base, { [impulseMetric]: delta }, matrix, steps))
    }}>Запустить</button>
    {testResult && <p>Результат: {METRICS.map((m) => `${m.labelRu}: ${testResult[m.id].toFixed(1)}`).join(' | ')}</p>}
  </section>
}
