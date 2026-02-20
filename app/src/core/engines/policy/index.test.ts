import { beforeEach, describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import { buildActionLibrary, buildStateVector, evaluatePolicies, evaluatePoliciesWithAudit, type PolicyConstraints } from './index'
import type { CheckinRecord } from '../../models/checkin'

;(globalThis as unknown as { self: typeof globalThis }).self = globalThis

const checkin: CheckinRecord = {
  ts: 1710000000000,
  energy: 6,
  focus: 6,
  mood: 6,
  stress: 4,
  sleepHours: 7,
  social: 5,
  productivity: 6,
  health: 6,
  cashFlow: 1000,
}

const constraints: PolicyConstraints = {
  maxPCollapse: 0.02,
  sirenCap: 0.02,
  maxDebtGrowth: 0.2,
  minRecoveryScore: 55,
}

describe('policy engine', () => {
  beforeEach(async () => {
    const { clearAllData } = await import('../../storage/repo')
    await clearAllData()
  })

  it('детерминирован при одинаковом входе', () => {
    const state = buildStateVector({
      latestCheckin: checkin,
      checkins: [checkin],
      activeGoal: null,
      regimeSnapshot: { ts: checkin.ts, dayKey: '2024-03-09', regimeId: 1, pCollapse: 0.21, sirenLevel: 'amber', explainTop3: [] },
    })
    const actions = buildActionLibrary()

    const first = evaluatePolicies({ state, actions, constraints, seed: 7 })
    const second = evaluatePolicies({ state, actions, constraints, seed: 7 })
    expect(first).toEqual(second)
  })

  it('режим осторожный отсекает рост риска сирены по ограничению', () => {
    const state = buildStateVector({ latestCheckin: checkin, checkins: [checkin], activeGoal: null })
    const result = evaluatePolicies({
      state,
      actions: [{
        id: 'x',
        titleRu: 'Агрессивный ход',
        type: 'graph',
        parameters: { delta: 1, lag: 0, horizon: 2 },
        tags: ['goal'],
        defaultCost: { timeMin: 10, energy: 4, money: 0, timeDebt: 0.1, risk: 0.02, entropy: 0.01 },
        domain: 'карьера',
        preconditions: () => true,
        effectsFn: () => ({ goalScore: 2, index: 0.5, pCollapse: 0.2, tailRisk: 0.1, debt: 0.3, sirenRisk: 0.2 }),
      }],
      constraints: {
        maxPCollapse: -1,
        sirenCap: -1,
        maxDebtGrowth: -1,
        minRecoveryScore: 0,
      },
    })

    expect(result[0].best.action.id).toContain('risk:hold')
  })

  it('fixed seed+state gives same choice and writes audit', async () => {
    const state = buildStateVector({ latestCheckin: checkin, checkins: [checkin], activeGoal: null })
    const params = { state, constraints, mode: 'balanced' as const, seed: 7, buildId: 'test', policyVersion: '2.0-01-pr1' }
    const first = await evaluatePoliciesWithAudit(params)
    const second = await evaluatePoliciesWithAudit(params)
    const firstBest = first.find((item) => item.mode === 'balanced')?.best.action.id
    const secondBest = second.find((item) => item.mode === 'balanced')?.best.action.id
    expect(firstBest).toBe(secondBest)

    const { getLastActionAudit } = await import('../../../repo/actionAuditRepo')
    const last = await getLastActionAudit()
    expect(last).toBeDefined()
    expect(last?.chosenActionId).toBe(secondBest)
    expect(last?.reproToken.seed).toBe(7)
  })
})
