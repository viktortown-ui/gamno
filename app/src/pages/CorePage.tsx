import { useEffect, useState } from 'react'
import { MetricControl } from '../components/MetricControl'
import { DEFAULT_CHECKIN_VALUES, INDEX_METRIC_IDS, METRICS, type MetricConfig, type MetricId } from '../core/metrics'
import type { CheckinRecord, CheckinValues } from '../core/models/checkin'
import { addCheckin } from '../core/storage/repo'
import { computeIndexDay, computeTopMovers } from '../core/engines/analytics/compute'
import { formatDateTime, formatNumber } from '../ui/format'

type SaveState = 'idle' | 'saving' | 'saved'

function clamp(metric: MetricConfig, value: number): number {
  return Math.min(metric.max, Math.max(metric.min, value))
}

function getValidationError(metric: MetricConfig, raw: string): string | undefined {
  if (raw.trim() === '') return 'Введите число.'
  const parsed = Number(raw)
  if (Number.isNaN(parsed)) return 'Введите корректное число.'
  if (parsed < metric.min || parsed > metric.max) {
    return `Диапазон: ${metric.min}…${metric.max}${metric.unitRu ? ` ${metric.unitRu}` : ''}.`
  }
  return undefined
}

export function CorePage({
  onSaved,
  latest,
  previous,
  templateValues,
}: {
  onSaved: (saved: CheckinRecord) => Promise<void>
  latest?: CheckinRecord
  previous?: CheckinRecord
  templateValues?: CheckinValues
}) {
  const [values, setValues] = useState<CheckinValues>(templateValues ?? DEFAULT_CHECKIN_VALUES)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [errors, setErrors] = useState<Partial<Record<MetricId, string>>>({})

  useEffect(() => {
    if (templateValues) {
      setValues(templateValues)
    }
  }, [templateValues])

  const updateValue = (id: MetricId, value: number) => {
    const metric = METRICS.find((item) => item.id === id)
    if (!metric) return
    setValues((prev) => ({ ...prev, [id]: clamp(metric, value) }))
  }

  const handleBlur = (metric: MetricConfig, raw: string) => {
    const error = getValidationError(metric, raw)
    setErrors((prev) => ({ ...prev, [metric.id]: error }))
    if (!error) {
      const parsed = Number(raw)
      setValues((prev) => ({ ...prev, [metric.id]: clamp(metric, parsed) }))
    }
  }

  const handleSave = async () => {
    setSaveState('saving')
    const savedRecord = await addCheckin(values)
    setSavedAt(savedRecord.ts)
    setSaveState('saved')
    await onSaved(savedRecord)
  }

  const dayIndex = latest ? computeIndexDay(latest) : 0
  const topDeltas = latest && previous
    ? computeTopMovers(
        INDEX_METRIC_IDS.reduce<Record<MetricId, number>>((acc, metricId) => {
          acc[metricId] = latest[metricId] - previous[metricId]
          return acc
        }, {} as Record<MetricId, number>),
      )
    : []

  return (
    <section className="page">
      <h1>Чек-ин</h1>
      <div className="form-grid">
        {METRICS.map((metric) => (
          <MetricControl
            key={metric.id}
            metric={metric}
            value={values[metric.id]}
            error={errors[metric.id]}
            onValueChange={(next) => updateValue(metric.id, next)}
            onBlur={(raw) => handleBlur(metric, raw)}
          />
        ))}
      </div>

      <div className="save-row">
        <button type="button" className="save-button" onClick={handleSave} disabled={saveState === 'saving'}>
          Сохранить чек-ин
        </button>
        <span className="save-feedback">
          {saveState === 'saving' ? 'Сохранение…' : null}
          {saveState === 'saved' && savedAt ? `Сохранено в ${new Date(savedAt).toLocaleTimeString('ru-RU')}` : null}
        </span>
      </div>

      <section className="last-checkin">
        <h2>Последний чек-ин</h2>
        {!latest ? (
          <p>Пока нет сохраненных чек-инов.</p>
        ) : (
          <>
            <p>{formatDateTime(latest.ts)}</p>
            <p>
              Индекс дня: <strong>{formatNumber(dayIndex)}</strong>
            </p>
            {topDeltas.length > 0 ? (
              <ul>
                {topDeltas.map((row) => (
                  <li key={row.metricId}>
                    Δ {METRICS.find((metric) => metric.id === row.metricId)?.labelRu}: {row.delta > 0 ? '+' : ''}
                    {formatNumber(row.delta)}
                  </li>
                ))}
              </ul>
            ) : (
              <p>Изменений относительно прошлого чек-ина пока нет.</p>
            )}
          </>
        )}
      </section>
    </section>
  )
}
