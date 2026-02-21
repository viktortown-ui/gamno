import { beforeEach, describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import { defaultInfluenceMatrix } from '../core/engines/influence/influence'

;(globalThis as unknown as { self: typeof globalThis }).self = globalThis

describe('multiverseRepo', () => {
  beforeEach(async () => {
    const { clearAllData } = await import('../core/storage/repo')
    await clearAllData()
  })

  it('делает roundtrip для сценариев, настроек и прогонов', async () => {
    const { saveScenario, listScenarios, saveSettings, getSettings, saveRun, getLastRun } = await import('./multiverseRepo')

    const scenario = await saveScenario({ nameRu: 'Тестовый контур', impulses: { energy: 0.7 }, baselineTs: Date.now() })
    const allScenarios = await listScenarios()
    expect(allScenarios[0]?.id).toBe(scenario.id)

    await saveSettings({ horizonDays: 14, sims: 5000, seed: 42, weightsSource: 'mixed', mix: 0.4, useShockProfile: true })
    const settings = await getSettings()
    expect(settings?.value.mix).toBe(0.4)

    await saveRun({
      ts: Date.now(),
      config: {
        horizonDays: 7,
        runs: 1000,
        seed: 42,
        indexFloor: 40,
        collapseConstraintPct: 20,
        shockMode: 'normal',
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
        var5IndexLoss: 3,
        cvar5IndexLoss: 4,
        var5Collapse: 0.3,
        cvar5Collapse: 0.4,
        indexLossTail: { alpha: 0.95, var: 3, es: 4, tailMean: 4, tailMass: 0.05, n: 100, method: 'linear-interpolated', warnings: [] },
        collapseTail: { alpha: 0.95, var: 0.3, es: 0.4, tailMean: 0.4, tailMass: 0.05, n: 100, method: 'linear-interpolated', warnings: [] },
      },
      quantiles: { days: [1], index: { p10: [1], p50: [2], p90: [3] }, pCollapse: { p10: [0.1], p50: [0.2], p90: [0.3] } },
      samplePaths: [[]],
      audit: { weightsSource: 'manual', mix: 0 },
      branches: [],
    })

    const last = await getLastRun()
    expect(last?.summary.redSirenAny).toBe(0.1)
  })
})
