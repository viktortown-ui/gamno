import { describe, expect, it, vi } from 'vitest'
import { completeQuest, createQuestFromSuggestion } from './quests'

describe('quests', () => {
  it('creates quest from suggestion', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000)
    const quest = createQuestFromSuggestion({
      title: 'Поддержать энергию ежедневной прогулкой',
      metricTarget: 'energy',
      delta: 1,
      horizonDays: 3,
      predictedIndexLift: 0.9,
      reasonRu: 'Тест',
    })

    expect(quest).toMatchObject({
      createdAt: 1700000000000,
      title: 'Поддержать энергию ежедневной прогулкой',
      metricTarget: 'energy',
      status: 'active',
    })
  })

  it('completes quest with outcome and xp', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1700000001000)
    const completed = completeQuest({
      createdAt: 1700000000000,
      title: 'Поддержать энергию ежедневной прогулкой',
      metricTarget: 'energy',
      delta: 1,
      horizonDays: 3,
      status: 'active',
      predictedIndexLift: 1.2,
    })

    expect(completed.status).toBe('completed')
    expect(completed.completedAt).toBe(1700000001000)
    expect(completed.xpEarned).toBeGreaterThan(0)
    expect(completed.outcomeRu).toBeTruthy()
  })
})
