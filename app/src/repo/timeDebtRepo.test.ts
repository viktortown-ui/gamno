import { beforeEach, describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'

;(globalThis as unknown as { self: typeof globalThis }).self = globalThis

describe('timeDebtRepo', () => {
  beforeEach(async () => {
    const { clearAllData } = await import('../core/storage/repo')
    await clearAllData()
  })

  it('сохраняет snapshot и читает обратно', async () => {
    const { addCheckin } = await import('../core/storage/repo')
    const { computeAndSaveSnapshot, getLastSnapshot, listSnapshots } = await import('./timeDebtRepo')

    const checkin = await addCheckin({ energy: 5, focus: 5, mood: 5, stress: 6, sleepHours: 6, social: 5, productivity: 5, health: 5, cashFlow: 0 })
    const created = await computeAndSaveSnapshot({ afterCheckinId: checkin.id })
    const last = await getLastSnapshot()
    const list = await listSnapshots({ limit: 10 })

    expect(created.id).toBeDefined()
    expect(last?.id).toBe(created.id)
    expect(list.length).toBeGreaterThan(0)
  })

  it('roundtrip настроек', async () => {
    const { getSettings, saveSettings } = await import('./timeDebtRepo')
    const before = await getSettings()
    await saveSettings({ ...before, targets: { sleepHours: 8 } })
    const after = await getSettings()
    expect(after.targets.sleepHours).toBe(8)
  })
})
