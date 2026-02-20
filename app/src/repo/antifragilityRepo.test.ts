import { beforeEach, describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'

;(globalThis as unknown as { self: typeof globalThis }).self = globalThis

describe('antifragilityRepo', () => {
  beforeEach(async () => {
    const { clearAllData } = await import('../core/storage/repo')
    await clearAllData()
  })

  it('roundtrip snapshots + sessions', async () => {
    const { addCheckin } = await import('../core/storage/repo')
    const { createShockSession, computeAndSaveSnapshot, getLastSnapshot, listSnapshots, listShockSessions } = await import('./antifragilityRepo')

    const checkin = await addCheckin({ energy: 6, focus: 6, mood: 6, stress: 4, sleepHours: 7, social: 5, productivity: 6, health: 6, cashFlow: 0 })
    await createShockSession({ type: 'фокус', intensity: 2, plannedDurationMin: 20, status: 'planned', links: {} })

    const created = await computeAndSaveSnapshot({ afterCheckinId: checkin.id })
    const last = await getLastSnapshot()
    const snapshots = await listSnapshots()
    const sessions = await listShockSessions()

    expect(created.id).toBeDefined()
    expect(last?.id).toBe(created.id)
    expect(snapshots.length).toBeGreaterThan(0)
    expect(sessions[0].type).toBe('фокус')
  })
})
