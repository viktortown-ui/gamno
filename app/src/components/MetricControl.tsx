import { useEffect, useState, type ChangeEventHandler, type FocusEventHandler } from 'react'
import type { MetricConfig } from '../core/metrics'

interface MetricControlProps {
  metric: MetricConfig
  value: number
  error?: string
  onValueChange: (next: number) => void
  onBlur: (raw: string) => void
}

export function MetricControl({ metric, value, error, onValueChange, onBlur }: MetricControlProps) {
  const [draftValue, setDraftValue] = useState(String(value))

  useEffect(() => {
    setDraftValue(String(value))
  }, [value])

  const normalizeToStep = (next: number) => {
    const stepped = Math.round(next / metric.step) * metric.step
    return Number(stepped.toFixed(metric.step < 1 ? 1 : 0))
  }

  const clamp = (next: number) => Math.min(metric.max, Math.max(metric.min, next))

  const updateFromNumberInput: ChangeEventHandler<HTMLInputElement> = (event) => {
    const raw = event.target.value
    setDraftValue(raw)

    if (raw === '') {
      return
    }

    const parsed = Number(raw)
    if (Number.isNaN(parsed)) {
      return
    }

    onValueChange(clamp(normalizeToStep(parsed)))
  }

  const handleBlur: FocusEventHandler<HTMLInputElement> = () => {
    setDraftValue(String(value))
    onBlur(draftValue)
  }

  const sliderEnabled = metric.sliderEnabled !== false

  return (
    <label className="metric-control">
      <div className="metric-control__head">
        <span>{metric.labelRu}</span>
        {metric.unitRu ? <span className="metric-control__unit">{metric.unitRu}</span> : null}
      </div>

      {sliderEnabled ? (
        <>
          <input
            type="range"
            min={metric.min}
            max={metric.max}
            step={metric.step}
            value={value}
            onChange={(event) => onValueChange(Number(event.target.value))}
          />
          <div className="metric-control__scale">
            <span>{metric.min}</span>
            <span>{metric.max}</span>
          </div>
        </>
      ) : null}

      <input
        type="number"
        min={metric.min}
        max={metric.max}
        step={metric.step}
        value={draftValue}
        onChange={updateFromNumberInput}
        onBlur={handleBlur}
      />

      {error ? <span className="metric-control__error">{error}</span> : null}
    </label>
  )
}
