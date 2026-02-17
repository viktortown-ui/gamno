import { beforeEach, describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'

;(globalThis as unknown as { self: typeof globalThis }).self = globalThis

describe('quest persistence', () => {
  beforeEach(async () => {
    const { clearAllData } = await import('./repo')
    await clearAllData()
  })

  it('saves and reads quests from dexie', async () => {
    const { addQuest, listQuests } = await import('./repo')
    await addQuest({
      createdAt: 1700000000000,
      title: 'Тестовый квест',
      metricTarget: 'energy',
      delta: 1,
      horizonDays: 3,
      status: 'active',
      predictedIndexLift: 1.4,
    })

    const quests = await listQuests()
    expect(quests).toHaveLength(1)
    expect(quests[0].title).toBe('Тестовый квест')
  })
})
