import { INDEX_METRIC_IDS, type MetricId } from '../../metrics'
import { computeAverages, computeIndexTrend, getRange } from './compute'
import type { AlertSignal, CheckinRecord } from './types'

const RULE_TEXT = {
  energyStress: {
    titleRu: 'Критический дисбаланс ресурса',
    descriptionRu: 'Средняя энергия за 7 дней низкая, а стресс высокий.',
    suggestedActionsRu: [
      'Снизьте рабочую нагрузку на ближайшие 2 дня.',
      'Добавьте минимум 30 минут восстановления в день.',
      'Перенесите сложные задачи на утро после сна.',
    ],
  },
  sleep: {
    titleRu: 'Недостаток сна',
    descriptionRu: 'Средняя длительность сна за 7 дней ниже комфортного уровня.',
    suggestedActionsRu: [
      'Зафиксируйте время отхода ко сну на всю неделю.',
      'Уберите экраны за 1 час до сна.',
      'Сведите кофеин после обеда к минимуму.',
    ],
  },
  indexDrop: {
    titleRu: 'Индекс дня снижается',
    descriptionRu: 'Средний индекс за 7 дней заметно хуже предыдущего периода.',
    suggestedActionsRu: [
      'Проведите короткий разбор последних 7 дней.',
      'Сфокусируйтесь на 1-2 метриках с максимальной просадкой.',
      'Проверьте режим сна и восстановления.',
    ],
  },
} as const

export function evaluateSignals(records: CheckinRecord[], nowTs = Date.now()): AlertSignal[] {
  const last7 = getRange(records, 7, nowTs)
  if (last7.length === 0) return []

  const averages = computeAverages(last7, INDEX_METRIC_IDS as MetricId[])
  const trend = computeIndexTrend(records, 7, nowTs)
  const signals: AlertSignal[] = []

  if ((averages.energy ?? 0) <= 3 && (averages.stress ?? 0) >= 7) {
    signals.push({
      titleRu: RULE_TEXT.energyStress.titleRu,
      descriptionRu: RULE_TEXT.energyStress.descriptionRu,
      severity: 'red',
      suggestedActionsRu: RULE_TEXT.energyStress.suggestedActionsRu,
    })
  }

  if ((averages.sleepHours ?? 0) < 6) {
    signals.push({
      titleRu: RULE_TEXT.sleep.titleRu,
      descriptionRu: RULE_TEXT.sleep.descriptionRu,
      severity: 'yellow',
      suggestedActionsRu: RULE_TEXT.sleep.suggestedActionsRu,
    })
  }

  if (trend.delta <= -1.0) {
    signals.push({
      titleRu: RULE_TEXT.indexDrop.titleRu,
      descriptionRu: RULE_TEXT.indexDrop.descriptionRu,
      severity: 'yellow',
      suggestedActionsRu: RULE_TEXT.indexDrop.suggestedActionsRu,
    })
  }

  return signals
}
