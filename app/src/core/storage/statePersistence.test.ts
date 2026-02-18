import { beforeEach, describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'

;(globalThis as unknown as { self: typeof globalThis }).self = globalThis

describe('state snapshots persistence', () => {
  beforeEach(async () => {
    const { clearAllData } = await import('./repo')
    await clearAllData()
  })

  it('сохраняет снимок после чек-ина', async () => {
    const { addCheckin, getLatestStateSnapshot, listStateSnapshots } = await import('./repo')

    await addCheckin({
      energy: 7,
      focus: 6,
      mood: 6,
      stress: 4,
      sleepHours: 7,
      social: 5,
      productivity: 7,
      health: 6,
      cashFlow: 12000,
    })

    const latest = await getLatestStateSnapshot()
    const all = await listStateSnapshots()

    expect(latest).toBeDefined()
    expect(latest?.stats.strength).toBeGreaterThan(50)
    expect(latest?.level).toBeGreaterThanOrEqual(1)
    expect(all).toHaveLength(1)
  })

  it('сохраняет новый снимок после завершения миссии', async () => {
    const { addCheckin, addQuest, completeQuestById, listStateSnapshots } = await import('./repo')

    await addCheckin({
      energy: 6,
      focus: 6,
      mood: 6,
      stress: 5,
      sleepHours: 7,
      social: 5,
      productivity: 6,
      health: 6,
      cashFlow: 0,
    })

    const quest = await addQuest({
      createdAt: Date.now(),
      title: 'Поддержать фокус',
      metricTarget: 'focus',
      delta: 1,
      horizonDays: 3,
      status: 'active',
      predictedIndexLift: 1.3,
    })

    await completeQuestById(quest.id!)
    const snapshots = await listStateSnapshots()

    expect(snapshots).toHaveLength(2)
    expect(snapshots[0].xp).toBeGreaterThanOrEqual(snapshots[1].xp)
  })
})
