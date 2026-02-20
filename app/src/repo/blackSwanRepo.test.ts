import { beforeEach, describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '../core/storage/db'
import { createBlackSwanScenario, deleteBlackSwanScenario, getLastBlackSwanRun, listBlackSwanScenarios, saveBlackSwanRun } from './blackSwanRepo'

describe('blackSwanRepo', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  it('scenarios CRUD', async () => {
    const row = await createBlackSwanScenario({ nameRu: 'Тест', shocks: [{ metricId: 'stress', delta: 1, durationDays: 2 }] })
    expect(row.id).toBeDefined()
    const all = await listBlackSwanScenarios()
    expect(all.length).toBe(1)
    await deleteBlackSwanScenario(row.id!)
    expect((await listBlackSwanScenarios()).length).toBe(0)
  })

  it('runs persistence roundtrip', async () => {
    await saveBlackSwanRun({ ts: Date.now(), horizon: 7, sims: 500, seed: 42, weightsSource: 'manual', mix: 0, summary: { pRed7d: 0.2, esCollapse10: 0.3, sirenLevel: 'amber', probEverRed: 0.2, probThresholdEnd: 0.1, esCoreIndex: 4 }, payload: { days: [1], coreIndex: { p10: [1], p50: [2], p90: [3] }, pCollapse: { p10: [0.1], p50: [0.2], p90: [0.3] }, histogram: [{ bucket: '0-1', value: 2 }], tail: { probEverRed: 0.2, probThresholdEnd: 0.1, probThresholdEver: 0.3, esCoreIndex: 4, esCollapse: 0.3 }, topDrivers: [], recommendations: [], noteRu: 'ok' } })
    const last = await getLastBlackSwanRun()
    expect(last?.summary.pRed7d).toBe(0.2)
  })
})
