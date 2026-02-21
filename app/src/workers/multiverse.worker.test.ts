import { describe, expect, it } from 'vitest'
import { runMultiverse } from '../core/engines/multiverse/simulator'
import { defaultInfluenceMatrix } from '../core/engines/influence/influence'

describe('multiverse worker entry contract', () => {
  it('возвращает ветки и рычаги', () => {
    const base = { ts: Date.now(), energy: 5, focus: 5, mood: 5, stress: 5, sleepHours: 7, social: 5, productivity: 5, health: 5, cashFlow: 0 }
    const result = runMultiverse({
      horizonDays: 7,
      runs: 1000,
      seed: 7,
      indexFloor: 40,
      collapseConstraintPct: 20,
      shockMode: 'normal',
      baseVector: base,
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
    })

    expect(result.branches).toHaveLength(3)
    expect(result.actionLevers.length).toBeGreaterThan(0)
    expect(result.tail.collapseTail.es).toBeGreaterThanOrEqual(result.tail.collapseTail.var)
  })
})
