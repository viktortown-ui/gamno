import type { QuestRecord } from '../core/models/quest'
import { formatNumber } from './format'

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
  return (
    <section className="cockpit-strip mission-strip">
      <article><span>Индекс</span><strong>{formatNumber(index)}</strong></article>
      <article><span>Риск</span><strong>{risk}</strong></article>
      <article><span>Прогноз</span><strong>{formatNumber(forecast)}</strong></article>
      <article><span>Сигналы</span><strong>{signals}</strong></article>
      <article><span>Волатильность</span><strong>{volatility}</strong></article>
      <article><span>Текущая миссия</span><strong>{activeQuest ? activeQuest.title : 'Не выбрана'}</strong></article>
    </section>
  )
}
