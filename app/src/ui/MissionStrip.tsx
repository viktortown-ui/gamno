import type { QuestRecord } from '../core/models/quest'
import { REGIMES } from '../core/regime/model'
import type { RegimeId } from '../core/models/regime'
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

function sirenBadge(level: 'green' | 'amber' | 'red'): 'low' | 'mid' | 'high' {
  if (level === 'red') return 'high'
  if (level === 'amber') return 'mid'
  return 'low'
}

export function MissionStrip({
  index,
  risk,
  forecast,
  signals,
  volatility,
  confidence,
  regimeId,
  pCollapse,
  sirenLevel,
  activeQuest,
  goalSummary,
  tailRisk,
  socialTop3,
}: {
  index: number
  risk: string
  forecast: number
  signals: number
  volatility: string
  confidence: 'низкая' | 'средняя' | 'высокая'
  regimeId: RegimeId
  pCollapse: number
  sirenLevel: 'green' | 'amber' | 'red'
  activeQuest?: QuestRecord
  goalSummary?: { score: number; trend: 'up' | 'down' | null } | null
  tailRisk?: { pRed7d: number; esCollapse10: number } | null
  socialTop3?: Array<{ metric: string; text: string }>
}) {
  const indexPct = clampPercent(index, 0, 10)
  const forecastPct = clampPercent(forecast, 0, 10)
  const signalSeverity = signals >= 3 ? 'high' : signals >= 1 ? 'mid' : 'low'
  const confidenceSeverity = confidence === 'высокая' ? 'low' : confidence === 'средняя' ? 'mid' : 'high'
  const regime = REGIMES.find((item) => item.id === regimeId) ?? REGIMES[0]

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
        <span>Режим</span>
        <strong>{regime.labelRu}</strong>
      </article>
      <article>
        <span>Сирена</span>
        <strong><span className={`status-badge status-badge--${sirenBadge(sirenLevel)}`}>{sirenLevel.toUpperCase()}</span></strong>
      </article>
      <article>
        <span>P(collapse)</span>
        <strong className="mono">{(pCollapse * 100).toFixed(1)}%</strong>
      </article>
      <article>
        <span>Прогноз 7д (p50)</span>
        <strong className="mono">{formatNumber(forecast)}</strong>
        <div className="meter" aria-hidden="true"><div className="meter__fill meter__fill--alt" style={{ width: `${forecastPct}%` }} /></div>
      </article>
      <article>
        <span>Уверенность</span>
        <strong className="mono"><span className={`status-badge status-badge--${confidenceSeverity}`}>{confidence}</span></strong>
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
      <article>
        <span>Цель</span>
        <strong className="mono">{goalSummary ? `${goalSummary.score.toFixed(1)} ${goalSummary.trend === 'up' ? '↑' : goalSummary.trend === 'down' ? '↓' : ''}` : '—'}</strong>
      </article>
      <article>
        <span>Tail risk</span>
        <strong className="mono">{tailRisk ? `P(RED,7д) ${(tailRisk.pRed7d * 100).toFixed(1)}% · ES ${(tailRisk.esCollapse10 * 100).toFixed(1)}%` : '—'}</strong>
      </article>
      <article>
        <span>Топ-3 влияния недели</span>
        <strong>{socialTop3?.length ? socialTop3.map((item) => item.text).join(' · ') : '—'}</strong>
      </article>
    </section>
  )
}
