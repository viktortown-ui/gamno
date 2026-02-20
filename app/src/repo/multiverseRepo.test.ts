import { beforeEach, describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import { defaultInfluenceMatrix } from '../core/engines/influence/influence'

;(globalThis as unknown as { self: typeof globalThis }).self = globalThis

describe('multiverseRepo', () => {
  beforeEach(async () => {
    const { clearAllData } = await import('../core/storage/repo')
    await clearAllData()
  })

  it('сохраняет и читает multiverseRuns', async () => {
    const { saveMultiverseRun, getLastMultiverseRun } = await import('./multiverseRepo')

    await saveMultiverseRun({
      ts: Date.now(),
      config: {
        horizonDays: 7,
        runs: 1000,
        seed: 42,
        indexFloor: 40,
        baseVector: { energy: 5, focus: 5, mood: 5, stress: 5, sleepHours: 7, social: 5, productivity: 5, health: 5, cashFlow: 0 },
        baseIndex: 5,
        basePCollapse: 0.2,
        baseRegime: 0,
        matrix: defaultInfluenceMatrix,
        weightsSource: 'manual',
        mix: 0,
        transitionMatrix: [[1]],
        toggles: { forecastNoise: true, weightsNoise: false, stochasticRegime: false },
        plan: { nameRu: 'Тест', impulses: [] },
        audit: {},
      },
      summary: {
        redSirenAny: 0.1,
        indexFloorBreachAny: 0.2,
        expectedDeltaIndex: 0.3,
        expectedDeltaGoalScore: 0,
        expectedDeltaPCollapse: -0.01,
        probabilityIndexBelowFloorAtHorizon: 0.05,
        cvar5Index: 42,
      },
      quantiles: {
        days: [1],
        index: { p10: [1], p50: [2], p90: [3] },
        pCollapse: { p10: [0.1], p50: [0.2], p90: [0.3] },
      },
      samplePaths: [[]],
      audit: { weightsSource: 'manual', mix: 0 },
    })

    const last = await getLastMultiverseRun()
    expect(last).toBeDefined()
    expect(last?.summary.redSirenAny).toBe(0.1)
  })
})
