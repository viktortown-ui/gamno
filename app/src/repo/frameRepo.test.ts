import { beforeEach, describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'

;(globalThis as unknown as { self: typeof globalThis }).self = globalThis

describe('frameRepo', () => {
  beforeEach(async () => {
    const { clearAllData, seedTestData } = await import('../core/storage/repo')
    await clearAllData()
    await seedTestData(7, 42)
  })

  it('compute/save/get roundtrip', async () => {
    const { computeAndSaveFrame, getLastFrame, listFrames } = await import('./frameRepo')
    const saved = await computeAndSaveFrame()
    const last = await getLastFrame()
    const list = await listFrames({ limit: 5 })
    expect(last?.id).toBe(saved.id)
    expect(list.length).toBeGreaterThan(0)
  })
})
