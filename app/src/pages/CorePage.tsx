import { useEffect, useMemo, useState } from 'react'
import { MetricControl } from '../components/MetricControl'
import { DEFAULT_CHECKIN_VALUES, INDEX_METRIC_IDS, METRICS, type MetricConfig, type MetricId } from '../core/metrics'
import type { CheckinRecord, CheckinValues } from '../core/models/checkin'
import type { QuestRecord } from '../core/models/quest'
import { addCheckin, addQuest, loadInfluenceMatrix } from '../core/storage/repo'
import { computeIndexDay, computeTopMovers } from '../core/engines/analytics/compute'
import { formatDateTime, formatNumber } from '../ui/format'
import { buildCheckinResultInsight } from '../core/engines/engagement/suggestions'
import { createQuestFromSuggestion } from '../core/engines/engagement/quests'

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
  activeQuest,
  onQuestChange,
}: {
  onSaved: () => Promise<void>
  latest?: CheckinRecord
  previous?: CheckinRecord
  templateValues?: CheckinValues
  activeQuest?: QuestRecord
  onQuestChange: () => Promise<void>
}) {
  const [values, setValues] = useState<CheckinValues>(templateValues ?? DEFAULT_CHECKIN_VALUES)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [savedRecord, setSavedRecord] = useState<CheckinRecord | null>(null)
  const [errors, setErrors] = useState<Partial<Record<MetricId, string>>>({})
  const [matrixLoadedAt, setMatrixLoadedAt] = useState<number>(0)

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
    const saved = await addCheckin(values)
    setSavedRecord(saved)
    setSavedAt(saved.ts)
    setSaveState('saved')
    setMatrixLoadedAt(Date.now())
    await onSaved()
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

  const resultInsight = useMemo(() => {
    if (!savedRecord) return null
    return loadInfluenceMatrix().then((matrix) => buildCheckinResultInsight(savedRecord, latest, matrix))
  }, [savedRecord, latest, matrixLoadedAt])

  const [resolvedInsight, setResolvedInsight] = useState<Awaited<typeof resultInsight> | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!resultInsight) {
      setResolvedInsight(null)
      return
    }

    void resultInsight.then((value) => {
      if (!cancelled) setResolvedInsight(value)
    })

    return () => {
      cancelled = true
    }
  }, [resultInsight])

  const acceptAction = async () => {
    if (!resolvedInsight?.bestLever) return
    const quest = createQuestFromSuggestion(resolvedInsight.bestLever)
    await addQuest(quest)
    await onQuestChange()
  }

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

      {resolvedInsight ? (
        <section className="result-panel panel">
          <h2>Результат чек-ина</h2>
          <p>Индекс дня: <strong>{formatNumber(resolvedInsight.index)}</strong> ({resolvedInsight.deltaVsPrevious > 0 ? '+' : ''}{formatNumber(resolvedInsight.deltaVsPrevious)} к прошлому)</p>
          <p>Главный драйвер: <strong>{resolvedInsight.topDriver?.text ?? 'Недостаточно данных'}</strong></p>
          <p>
            Лучший рычаг дня:{' '}
            <strong>{resolvedInsight.bestLever?.title ?? 'Пока не найден'}</strong>
            {resolvedInsight.bestLever ? ` (ожидаемый рост индекса: +${formatNumber(resolvedInsight.bestLever.predictedIndexLift)})` : ''}
          </p>
          <div className="save-row">
            <button type="button" onClick={acceptAction} disabled={!resolvedInsight.bestLever || Boolean(activeQuest)}>
              Принять действие
            </button>
            {activeQuest ? <span className="chip">У вас уже есть активный квест</span> : null}
          </div>
        </section>
      ) : null}

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
