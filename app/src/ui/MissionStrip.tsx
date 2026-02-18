import type { QuestRecord } from '../core/models/quest'
import { formatNumber } from './format'

function clampPercent(value: number, min: number, max: number): number {
  const normalized = ((value - min) / (max - min)) * 100
  return Math.max(0, Math.min(100, normalized))
}

function riskLevel(risk: string): 'low' | 'mid' | 'high' {
  if (risk === 'повышенный') return 'high'
  if (risk === 'средний') return 'mid'
  return 'low'
}

export function MissionStrip({
  index,
  risk,
  forecast,
  signals,
  volatility,
  activeQuest,
}: {
  index: number
  risk: string
  forecast: number
  signals: number
  volatility: string
  activeQuest?: QuestRecord
}) {
  const indexPct = clampPercent(index, 0, 10)
  const forecastPct = clampPercent(forecast, 0, 10)
  const signalSeverity = signals >= 3 ? 'high' : signals >= 1 ? 'mid' : 'low'

  return (
    <section className="cockpit-strip mission-strip">
      <article>
        <span>Индекс</span>
        <strong className="mono">{formatNumber(index)}</strong>
        <div className="meter" aria-hidden="true"><div className="meter__fill" style={{ width: `${indexPct}%` }} /></div>
      </article>
      <article>
        <span>Риск</span>
        <strong><span className={`status-badge status-badge--${riskLevel(risk)}`}>{risk}</span></strong>
      </article>
      <article>
        <span>Прогноз</span>
        <strong className="mono">{formatNumber(forecast)}</strong>
        <div className="meter" aria-hidden="true"><div className="meter__fill meter__fill--alt" style={{ width: `${forecastPct}%` }} /></div>
      </article>
      <article>
        <span>Сигналы</span>
        <strong className="mono"><span className={`status-badge status-badge--${signalSeverity}`}>{signals}</span></strong>
      </article>
      <article>
        <span>Волатильность</span>
        <strong>{volatility}</strong>
      </article>
      <article>
        <span>Текущая миссия</span>
        <strong>{activeQuest ? activeQuest.title : 'Не выбрана'}</strong>
      </article>
    </section>
  )
}
