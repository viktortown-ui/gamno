export interface RuleSummary {
  energyAvg7d: number
  stressAvg7d: number
  sleepAvg7d: number
  indexDelta7d: number
}

export interface SignalResult {
  id: string
  severity: 'red' | 'yellow'
  titleRu: string
  descriptionRu: string
  actionsRu: string[]
}

export function evaluateSignals(summary: RuleSummary): SignalResult[] {
  const signals: SignalResult[] = []

  if (summary.energyAvg7d <= 3 && summary.stressAvg7d >= 7) {
    signals.push({
      id: 'risk-breakdown',
      severity: 'red',
      titleRu: 'Риск срыва',
      descriptionRu: 'Низкая энергия на фоне высокого стресса за последние 7 дней.',
      actionsRu: ['Снизьте нагрузку на 1–2 дня.', 'Добавьте восстановление в расписание.', 'Сфокусируйтесь на сне сегодня.'],
    })
  }

  if (summary.sleepAvg7d < 6) {
    signals.push({
      id: 'sleep-debt',
      severity: 'yellow',
      titleRu: 'Недосып',
      descriptionRu: 'Средний сон за 7 дней ниже 6 часов.',
      actionsRu: ['Зафиксируйте время отбоя.', 'Уберите экраны за час до сна.', 'Сократите вечерний кофеин.'],
    })
  }

  if (summary.indexDelta7d <= -1.0) {
    signals.push({
      id: 'index-drop',
      severity: 'yellow',
      titleRu: 'Падение индекса',
      descriptionRu: 'Средний индекс за последние 7 дней ниже прошлого окна.',
      actionsRu: ['Проверьте метрики с наибольшей просадкой.', 'Пересоберите план недели.', 'Сделайте легкий день восстановления.'],
    })
  }

  return signals
}
