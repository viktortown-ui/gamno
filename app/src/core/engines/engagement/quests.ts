import type { QuestRecord } from '../../models/quest'
import type { QuestSuggestion } from './suggestions'

const outcomeTemplates = [
  'Отличный шаг. Видно укрепление устойчивости.',
  'Выполнено. Система получила полезный сигнал прогресса.',
  'Сильный ход. Вероятность хорошего дня выросла.',
]

export function createQuestFromSuggestion(suggestion: QuestSuggestion): QuestRecord {
  return {
    createdAt: Date.now(),
    title: suggestion.title,
    metricTarget: suggestion.metricTarget,
    delta: suggestion.delta,
    horizonDays: suggestion.horizonDays,
    status: 'active',
    predictedIndexLift: suggestion.predictedIndexLift,
  }
}

export function completeQuest(quest: QuestRecord): QuestRecord {
  const xpEarned = Math.max(8, Math.round(Math.abs(quest.delta) * 10 + quest.horizonDays * 2))
  const messageIndex = Math.abs(quest.title.length + quest.horizonDays + Math.round(quest.predictedIndexLift)) % outcomeTemplates.length
  return {
    ...quest,
    status: 'completed',
    completedAt: Date.now(),
    xpEarned,
    outcomeRu: outcomeTemplates[messageIndex],
  }
}
