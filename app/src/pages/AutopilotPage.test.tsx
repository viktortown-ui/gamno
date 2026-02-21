/* @vitest-environment jsdom */
import { act } from 'react'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActionAuditRecord } from '../repo/actionAuditRepo'
import type { PolicyResult } from '../core/engines/policy'

vi.mock('../core/storage/repo', () => ({
  addQuest: vi.fn(async () => undefined),
  getActiveGoal: vi.fn(async () => null),
  getLatestCheckin: vi.fn(async () => ({ id: 1, ts: Date.now() })),
  getLatestRegimeSnapshot: vi.fn(async () => undefined),
  getLatestStateSnapshot: vi.fn(async () => undefined),
  listCheckins: vi.fn(async () => []),
}))

vi.mock('../repo/blackSwanRepo', () => ({ getLastBlackSwanRun: vi.fn(async () => undefined) }))
vi.mock('../repo/timeDebtRepo', () => ({ getLastSnapshot: vi.fn(async () => undefined) }))
vi.mock('../repo/antifragilityRepo', () => ({ getLastSnapshot: vi.fn(async () => undefined) }))
vi.mock('../repo/policyRepo', () => ({
  createPolicy: vi.fn(async () => ({ id: 10 })),
  getActivePolicy: vi.fn(async () => null),
  saveRun: vi.fn(async () => ({ ts: 123456, audit: { weightsSource: 'manual', mix: 0.4, forecastConfidence: 'средняя' } })),
  setActivePolicy: vi.fn(async () => undefined),
}))

const policyResults: PolicyResult[] = [
  {
    mode: 'risk',
    nameRu: 'Осторожный',
    ranked: [
      { action: { id: 'risk:1', titleRu: 'Действие Риск 1' } as PolicyResult['best']['action'], score: 2, penalty: 0.2, deltas: { goalScore: 0.2, index: 0.1, pCollapse: 0.01, tailRisk: 0.02, debt: 0.03, sirenRisk: 0.01 }, reasonsRu: ['Причина 1'] },
      { action: { id: 'risk:2', titleRu: 'Действие Риск 2' } as PolicyResult['best']['action'], score: 1.8, penalty: 0.2, deltas: { goalScore: 0.1, index: 0.1, pCollapse: 0.01, tailRisk: 0.02, debt: 0.03, sirenRisk: 0.01 }, reasonsRu: ['Причина 2'] },
    ],
    best: { action: { id: 'risk:1', titleRu: 'Действие Риск 1' } as PolicyResult['best']['action'], score: 2, penalty: 0.2, deltas: { goalScore: 0.2, index: 0.1, pCollapse: 0.01, tailRisk: 0.02, debt: 0.03, sirenRisk: 0.01 }, reasonsRu: ['Причина 1'] },
  },
  {
    mode: 'balanced',
    nameRu: 'Сбалансированный',
    ranked: [
      { action: { id: 'bal:1', titleRu: 'Действие Баланс 1' } as PolicyResult['best']['action'], score: 4, penalty: 0.3, deltas: { goalScore: 0.4, index: 0.3, pCollapse: 0.01, tailRisk: 0.01, debt: 0.02, sirenRisk: 0.01 }, reasonsRu: ['Причина 3'] },
      { action: { id: 'bal:2', titleRu: 'Действие Баланс 2' } as PolicyResult['best']['action'], score: 3, penalty: 0.2, deltas: { goalScore: 0.2, index: 0.2, pCollapse: 0.01, tailRisk: 0.01, debt: 0.2, sirenRisk: 0.01 }, reasonsRu: ['Причина 4'] },
    ],
    best: { action: { id: 'bal:1', titleRu: 'Действие Баланс 1' } as PolicyResult['best']['action'], score: 4, penalty: 0.3, deltas: { goalScore: 0.4, index: 0.3, pCollapse: 0.01, tailRisk: 0.01, debt: 0.02, sirenRisk: 0.01 }, reasonsRu: ['Причина 3'] },
  },
  {
    mode: 'growth',
    nameRu: 'Разгон',
    ranked: [
      { action: { id: 'grow:1', titleRu: 'Действие Рост 1' } as PolicyResult['best']['action'], score: 5, penalty: 0.4, deltas: { goalScore: 0.6, index: 0.4, pCollapse: 0.02, tailRisk: 0.02, debt: 0.04, sirenRisk: 0.02 }, reasonsRu: ['Причина 5'] },
    ],
    best: { action: { id: 'grow:1', titleRu: 'Действие Рост 1' } as PolicyResult['best']['action'], score: 5, penalty: 0.4, deltas: { goalScore: 0.6, index: 0.4, pCollapse: 0.02, tailRisk: 0.02, debt: 0.04, sirenRisk: 0.02 }, reasonsRu: ['Причина 5'] },
  },
]

const latestAudit: ActionAuditRecord = {
  id: 7,
  ts: 123456,
  chosenActionId: 'bal:1',
  stateHash: 'hstate',
  seed: 42,
  reproToken: { buildId: 'dev', seed: 42, stateHash: 'hstate', catalogHash: 'hcat', policyVersion: '2.0-01-pr4' },
  topCandidates: [{ actionId: 'bal:1', score: 4, penalty: 0.3 }],
  whyTopRu: ['• Лучший баланс'],
  horizonSummary: [
    { horizonDays: 3, policyMode: 'balanced', actionId: 'bal:1', stats: { mean: 1, p10: 0.5, p50: 1.2, p90: 1.8, tail: 0.11, var97_5: 0.21, es97_5: 0.25, tailMass: 0.1, failRate: 0.05 } },
    { horizonDays: 3, policyMode: 'balanced', actionId: 'bal:2', stats: { mean: 1, p10: 0.4, p50: 1.1, p90: 1.6, tail: 0.1, var97_5: 0.2, es97_5: 0.22, tailMass: 0.08, failRate: 0.06 } },
    { horizonDays: 7, policyMode: 'balanced', actionId: 'bal:1', stats: { mean: 1, p10: 0.2, p50: 1.5, p90: 1.9, tail: 0.08, var97_5: 0.15, es97_5: 0.18, tailMass: 0.07, failRate: 0.03 } },
  ],
  modelHealth: { v: 1, kind: 'policy', grade: 'green', reasonsRu: ['Калибровка стабильная.'], data: { samples: 12, minSamples: 6, sufficient: true }, calibration: { brier: 0.08, worstGap: 0.09, bins: [] }, drift: { triggered: false, triggerIndex: null, score: 0.01 } },
}

vi.mock('../core/engines/policy', () => ({
  buildStateVector: vi.fn(() => ({ volatility: 1, sirenLevel: 0.2 })),
  evaluatePoliciesWithAudit: vi.fn(async () => policyResults),
}))

vi.mock('../repo/actionAuditRepo', () => ({
  getLastActionAudit: vi.fn(async () => latestAudit),
  listRecentActionAudits: vi.fn(async () => [latestAudit]),
}))

describe('AutopilotPage', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('renders briefing, duel, model health and drilldown from mocked outputs', async () => {
    const { AutopilotPage } = await import('./AutopilotPage')
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(<AutopilotPage onChanged={async () => undefined} />)
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(container.textContent).toContain('Briefing')
    expect(container.textContent).toContain('Policy Duel')
    expect(container.textContent).toContain('Action Drilldown')
    expect(container.textContent).toContain('Model Health: High · Калибровка стабильная.')
    expect(container.textContent).toContain('best p50:')
    expect(container.textContent).toContain('best by ES:')
    expect(container.textContent).toContain('safeMode influence:')
    expect(container.textContent).toContain('Текущий статус доверия модели: High')
  })

  it('maps candidates in deterministic order by p50, p90, actionId', async () => {
    const { getPolicyCards } = await import('./autopilotUi')
    const cards = getPolicyCards({
      results: policyResults,
      audit: {
        ...latestAudit,
        horizonSummary: [
          { horizonDays: 3, policyMode: 'risk', actionId: 'risk:b', stats: { mean: 0, p10: 0, p50: 1.2, p90: 1.5, tail: 0.2, var97_5: 0.2, es97_5: 0.3, tailMass: 0.1, failRate: 0.1 } },
          { horizonDays: 3, policyMode: 'risk', actionId: 'risk:a', stats: { mean: 0, p10: 0, p50: 1.2, p90: 1.5, tail: 0.2, var97_5: 0.2, es97_5: 0.3, tailMass: 0.1, failRate: 0.1 } },
          { horizonDays: 3, policyMode: 'risk', actionId: 'risk:c', stats: { mean: 0, p10: 0, p50: 1.3, p90: 1.4, tail: 0.2, var97_5: 0.2, es97_5: 0.3, tailMass: 0.1, failRate: 0.1 } },
        ],
      },
      horizon: 3,
    })

    expect(cards[0].candidates.map((item) => item.actionId)).toEqual(['risk:c', 'risk:a', 'risk:b'])
  })



  it('selects best by ES deterministically and reports safe mode fallback', async () => {
    const { getPolicyDuelSummary } = await import('./autopilotUi')
    const duel = getPolicyDuelSummary({
      horizonSummary: [
        { horizonDays: 3, policyMode: 'balanced', actionId: 'b', stats: { mean: 0, p10: 0, p50: 1, p90: 1.1, tail: 0.2, var97_5: 0.2, es97_5: 0.12, tailMass: 0.1, failRate: 0.1 } },
        { horizonDays: 3, policyMode: 'risk', actionId: 'a', stats: { mean: 0, p10: 0, p50: 1, p90: 1.1, tail: 0.2, var97_5: 0.2, es97_5: 0.12, tailMass: 0.1, failRate: 0.1 } },
      ],
      horizon: 3,
      safeMode: true,
      fallbackPolicy: 'risk',
    })

    expect(duel.es).toBe('risk/a')
    expect(duel.safeModeInfluence).toContain('fallback risk')
  })

  it('builds drilldown delta preview and budget warning deterministically', async () => {
    const { getDrilldownCandidates } = await import('./autopilotUi')
    const rows = getDrilldownCandidates({
      selected: policyResults[1],
      constraints: { maxPCollapse: 0.03, sirenCap: 0.03, maxDebtGrowth: 0.1, minRecoveryScore: 55 },
      topK: 2,
    })

    expect(rows).toHaveLength(2)
    expect(rows[0].id).toBe('bal:1')
    expect(rows[1].warnings).toContain('Рост долга выше лимита.')
    expect(rows[0].deltas.goalScore).toBe(0.4)
  })
})
