import { beforeEach, describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'

;(globalThis as unknown as { self: typeof globalThis }).self = globalThis

describe('regime snapshots persistence', () => {
  beforeEach(async () => {
    const { clearAllData } = await import('./repo')
    await clearAllData()
  })

  it('roundtrip сохраняет/читает regimeSnapshots', async () => {
    const { addCheckin, getLatestRegimeSnapshot, listRegimeSnapshots } = await import('./repo')

    await addCheckin({
      energy: 6,
      focus: 6,
      mood: 6,
      stress: 4,
      sleepHours: 7,
      social: 5,
      productivity: 6,
      health: 6,
      cashFlow: 10000,
    })

    const latest = await getLatestRegimeSnapshot()
    const all = await listRegimeSnapshots()

    expect(latest).toBeDefined()
    expect(latest?.explainTop3.length).toBeGreaterThan(0)
    expect(typeof latest?.pCollapse).toBe('number')
    expect(all.length).toBe(1)
  })
})
