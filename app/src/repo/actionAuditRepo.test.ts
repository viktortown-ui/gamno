import { beforeEach, describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'

;(globalThis as unknown as { self: typeof globalThis }).self = globalThis

describe('actionAuditRepo', () => {
  beforeEach(async () => {
    const { clearAllData } = await import('../core/storage/repo')
    await clearAllData()
  })

  it('writes and reads action audits and schema is v17+', async () => {
    const { schemaVersion } = await import('../core/storage/db')
    const { saveActionAudit, getLastActionAudit, listActionAuditsByStateSeed, listRecentActionAudits } = await import('./actionAuditRepo')

    expect(schemaVersion).toBeGreaterThanOrEqual(17)

    await saveActionAudit({
      ts: Date.now(),
      chosenActionId: 'focus:deep-25',
      stateHash: 'hstate',
      seed: 42,
      reproToken: { buildId: 'dev', seed: 42, stateHash: 'hstate', catalogHash: 'hcat', policyVersion: '2.0-01-pr1' },
      topCandidates: [{ actionId: 'focus:deep-25', score: 1.2, penalty: 0.3 }],
      whyTopRu: ['• Стабилен'],
      modelHealth: { placeholder: true },
    })

    const last = await getLastActionAudit()
    expect(last?.chosenActionId).toBe('focus:deep-25')
    expect(last?.reproToken.catalogHash).toBe('hcat')
    const byStateSeed = await listActionAuditsByStateSeed('hstate', 42)
    expect(byStateSeed.length).toBe(1)
    const recent = await listRecentActionAudits(5)
    expect(recent[0]?.chosenActionId).toBe('focus:deep-25')
  })
})
