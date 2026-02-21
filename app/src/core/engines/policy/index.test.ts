import { beforeEach, describe, expect, it, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { buildActionLibrary, buildStateVector, evaluateHonestyGates, evaluatePolicies, evaluatePoliciesWithAudit, type PolicyConstraints } from './index'
import { evaluatePolicyHorizonInWorker } from './policyHorizon.worker'
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


  it('honesty gates include safe mode for red grade or drift', () => {
    const gated = evaluateHonestyGates({ modelHealthGrade: 'red', driftDetected: true, requestedMode: 'growth' })
    expect(gated.safeMode).toBe(true)
    expect(gated.fallbackPolicy).toBe('risk')
    expect(gated.gatesApplied).toEqual(expect.arrayContaining(['model-health-red', 'drift-detected', 'tight-budget', 'tail-fail-penalty-up', 'restrict-risky-paths']))
    expect(gated.reasonsRu.length).toBeGreaterThan(0)
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


  it('engine uses worker horizon API and extends audit summary', async () => {
    const state = buildStateVector({ latestCheckin: checkin, checkins: [checkin], activeGoal: null })
    const created: string[] = []

    class FakeWorker {
      onmessage: ((event: MessageEvent<{ type: 'done'; result: ReturnType<typeof evaluatePolicyHorizonInWorker> }>) => void) | null = null
      constructor(url: URL) {
        created.push(String(url))
      }
      postMessage(message: { type: 'run'; input: Parameters<typeof evaluatePolicyHorizonInWorker>[0] }) {
        const result = evaluatePolicyHorizonInWorker(message.input)
        this.onmessage?.({ data: { type: 'done', result } } as MessageEvent<{ type: 'done'; result: typeof result }>)
      }
      terminate() {}
    }

    const originalWorker = globalThis.Worker
    ;(globalThis as unknown as { Worker: typeof Worker }).Worker = FakeWorker as unknown as typeof Worker

    const params = { state, constraints, mode: 'balanced' as const, seed: 19, buildId: 'test', policyVersion: '2.0-01-pr2' }
    await evaluatePoliciesWithAudit(params)

    ;(globalThis as unknown as { Worker: typeof Worker | undefined }).Worker = originalWorker

    expect(created.length).toBeGreaterThan(0)
    expect(created[0]).toContain('policyHorizon.worker.ts')

    const { getLastActionAudit } = await import('../../../repo/actionAuditRepo')
    const last = await getLastActionAudit()
    expect(last?.horizonSummary?.length).toBeGreaterThan(0)
    expect(last?.horizonSummary?.[0].stats).toHaveProperty('p50')
  })

  it('red/drift scenario applies safe mode, stays deterministic and persists gates in audit', async () => {
    const state = buildStateVector({ latestCheckin: checkin, checkins: [checkin], activeGoal: null })

    class FakeWorker {
      onmessage: ((event: MessageEvent<{ type: 'done'; result: ReturnType<typeof evaluatePolicyHorizonInWorker> }>) => void) | null = null
      constructor(url: URL) {
        void url
      }
      postMessage(message: { type: 'run'; input: Parameters<typeof evaluatePolicyHorizonInWorker>[0] }) {
        const result = evaluatePolicyHorizonInWorker(message.input)
        this.onmessage?.({ data: { type: 'done', result } } as MessageEvent<{ type: 'done'; result: typeof result }>)
      }
      terminate() {}
    }

    const originalWorker = globalThis.Worker
    ;(globalThis as unknown as { Worker: typeof Worker }).Worker = FakeWorker as unknown as typeof Worker

    const modelHealthModule = await import('../analytics/modelHealth')
    const healthSpy = vi.spyOn(modelHealthModule, 'evaluateModelHealth').mockReturnValue({
      v: 1,
      kind: 'policy',
      grade: 'red',
      reasonsRu: ['Тест: красная зона.'],
      data: { samples: 12, minSamples: 6, sufficient: true },
      calibration: { brier: 0.35, worstGap: 0.32, bins: [] },
      drift: { triggered: true, triggerIndex: 2, score: 0.33 },
    })

    const params = { state, constraints, mode: 'growth' as const, seed: 11, buildId: 'test', policyVersion: '2.0-02-pr7' }
    const first = await evaluatePoliciesWithAudit(params)
    const second = await evaluatePoliciesWithAudit(params)

    healthSpy.mockRestore()
    ;(globalThis as unknown as { Worker: typeof Worker | undefined }).Worker = originalWorker

    const firstBest = first.find((item) => item.mode === 'risk')?.best.action.id
    const secondBest = second.find((item) => item.mode === 'risk')?.best.action.id
    expect(firstBest).toBe(secondBest)

    const { getLastActionAudit } = await import('../../../repo/actionAuditRepo')
    const last = await getLastActionAudit()
    expect(last?.safeMode).toBe(true)
    expect(last?.fallbackPolicy).toBe('risk')
    expect(last?.gatesApplied).toEqual(expect.arrayContaining(['model-health-red', 'drift-detected']))
    expect(last?.gateReasonsRu?.join(' ')).toContain('безопасный режим')
  })

  it('fixed seed+state gives same choice and writes audit', async () => {
    const state = buildStateVector({ latestCheckin: checkin, checkins: [checkin], activeGoal: null })

    class FakeWorker {
      onmessage: ((event: MessageEvent<{ type: 'done'; result: ReturnType<typeof evaluatePolicyHorizonInWorker> }>) => void) | null = null
      constructor(url: URL) {
        void url
      }
      postMessage(message: { type: 'run'; input: Parameters<typeof evaluatePolicyHorizonInWorker>[0] }) {
        const result = evaluatePolicyHorizonInWorker(message.input)
        this.onmessage?.({ data: { type: 'done', result } } as MessageEvent<{ type: 'done'; result: typeof result }>)
      }
      terminate() {}
    }

    const originalWorker = globalThis.Worker
    ;(globalThis as unknown as { Worker: typeof Worker }).Worker = FakeWorker as unknown as typeof Worker

    const params = { state, constraints, mode: 'balanced' as const, seed: 7, buildId: 'test', policyVersion: '2.0-01-pr1' }
    const first = await evaluatePoliciesWithAudit(params)
    const second = await evaluatePoliciesWithAudit(params)

    ;(globalThis as unknown as { Worker: typeof Worker | undefined }).Worker = originalWorker

    const firstBest = first.find((item) => item.mode === 'balanced')?.best.action.id
    const secondBest = second.find((item) => item.mode === 'balanced')?.best.action.id
    expect(firstBest).toBe(secondBest)

    const { getLastActionAudit } = await import('../../../repo/actionAuditRepo')
    const last = await getLastActionAudit()
    expect(last).toBeDefined()
    const selectedMode = last?.fallbackPolicy ?? 'balanced'
    const expectedChosen = second.find((item) => item.mode === selectedMode)?.best.action.id
    expect(last?.chosenActionId).toBe(expectedChosen)
    expect(last?.reproToken.seed).toBe(7)
  })
})
