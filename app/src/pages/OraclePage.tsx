import { useEffect, useMemo, useState } from 'react'
import { INDEX_METRIC_IDS, METRICS, type MetricId } from '../core/metrics'
import type { CheckinRecord } from '../core/models/checkin'
import { addScenario, listScenarios, loadInfluenceMatrix } from '../core/storage/repo'
import { applyImpulse, explainDrivers } from '../core/engines/influence/influence'
import type { InfluenceMatrix, MetricVector, OracleScenario } from '../core/engines/influence/types'
import { computeIndexDay } from '../core/engines/analytics/compute'
import { formatNumber } from '../ui/format'

function toVector(base?: CheckinRecord): MetricVector | undefined {
  if (!base) return undefined
  return METRICS.reduce((acc, metric) => {
    acc[metric.id] = base[metric.id]
    return acc
  }, {} as MetricVector)
}

export function OraclePage({ latest }: { latest?: CheckinRecord }) {
  const [impulses, setImpulses] = useState<Partial<Record<MetricId, number>>>({})
  const [matrix, setMatrix] = useState<InfluenceMatrix | null>(null)
  const [saved, setSaved] = useState<OracleScenario[]>([])

  useEffect(() => {
    void loadInfluenceMatrix().then(setMatrix)
    void listScenarios().then(setSaved)
  }, [])

  const baseVector = useMemo(() => toVector(latest), [latest])
  const result = useMemo(() => (baseVector && matrix ? applyImpulse(baseVector, impulses, matrix, 2) : undefined), [baseVector, impulses, matrix])

  if (!latest || !baseVector || !matrix) return <section className="page"><h1>Оракул</h1><p>Нет базового чек-ина для сценариев.</p></section>

  const resultRecord = { ...latest, ...result }
  const drivers = explainDrivers(result!, baseVector, matrix)

  return <section className="page">
    <h1>Оракул</h1>
    <p>Сценарий: примените импульсы к метрикам.</p>
    <div className="metric-cards">{INDEX_METRIC_IDS.map((id) => {
      const m = METRICS.find((item) => item.id === id)!
      return <label key={id}>{m.labelRu} Δ<input type="number" value={impulses[id] ?? 0} onChange={(e) => setImpulses((p) => ({ ...p, [id]: Number(e.target.value) }))} /></label>
    })}</div>
    <p>Прогнозный индекс: <strong>{formatNumber(computeIndexDay(resultRecord))}</strong></p>
    <h2>Драйверы</h2>
    <ul>{drivers.map((d) => <li key={d}>{d}</li>)}</ul>
    <button type="button" onClick={async () => {
      const nameRu = window.prompt('Название сценария')
      if (!nameRu) return
      const scenario: OracleScenario = { ts: Date.now(), nameRu, baseTs: latest.ts, impulses, result: result!, index: computeIndexDay(resultRecord) }
      await addScenario(scenario)
      setSaved(await listScenarios())
    }}>Сохранить сценарий</button>

    <h2>Сохраненные сценарии</h2>
    <ul>{saved.map((row) => <li key={`${row.ts}-${row.nameRu}`}>{row.nameRu}: {formatNumber(row.index)}</li>)}</ul>
  </section>
}
