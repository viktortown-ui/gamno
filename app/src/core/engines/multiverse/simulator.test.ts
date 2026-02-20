import { describe, expect, it } from 'vitest'
import { defaultInfluenceMatrix } from '../influence/influence'
import { runMultiverse } from './simulator'
import type { MultiverseConfig } from './types'
import type { MetricVector } from '../influence/types'

const baseVector: MetricVector = {
  energy: 6,
  focus: 6,
  mood: 6,
  stress: 4,
  sleepHours: 7,
  social: 5,
  productivity: 6,
  health: 6,
  cashFlow: 0,
}

function buildConfig(seed: number): MultiverseConfig {
  return {
    horizonDays: 7,
    runs: 1000,
    seed,
    indexFloor: 40,
    baseVector,
    baseIndex: 6,
    basePCollapse: 0.2,
    baseRegime: 0,
    matrix: defaultInfluenceMatrix,
    weightsSource: 'manual',
    mix: 0,
    transitionMatrix: [
      [0.7, 0.1, 0.1, 0.05, 0.05],
      [0.2, 0.5, 0.1, 0.1, 0.1],
      [0.2, 0.1, 0.4, 0.2, 0.1],
      [0.2, 0.1, 0.2, 0.4, 0.1],
      [0.1, 0.1, 0.2, 0.2, 0.4],
    ],
    toggles: {
      forecastNoise: true,
      weightsNoise: true,
      stochasticRegime: true,
    },
    forecastResiduals: [-1, -0.5, 0, 0.5, 1],
    plan: {
      nameRu: 'Базовый план',
      impulses: [{ day: 0, metricId: 'sleepHours', delta: 0.5 }],
    },
    audit: {},
  }
}

describe('multiverse simulator', () => {
  it('детерминирован при одинаковом seed', () => {
    const a = runMultiverse(buildConfig(42))
    const b = runMultiverse(buildConfig(42))
    expect(a.quantiles).toEqual(b.quantiles)
    expect(a.tail).toEqual(b.tail)
  })

  it('квантили упорядочены p10 <= p50 <= p90', () => {
    const result = runMultiverse(buildConfig(42))
    result.quantiles.index.p10.forEach((p10, idx) => {
      const p50 = result.quantiles.index.p50[idx]
      const p90 = result.quantiles.index.p90[idx]
      expect(p10).toBeLessThanOrEqual(p50)
      expect(p50).toBeLessThanOrEqual(p90)
    })
  })

  it('позитивный импульс не ухудшает ожидаемый индекс в синтетике', () => {
    const config = buildConfig(10)
    const baseline = runMultiverse({ ...config, plan: { nameRu: 'Ноль', impulses: [] } })
    const positive = runMultiverse({ ...config, plan: { nameRu: 'Рост', impulses: [{ day: 0, metricId: 'energy', delta: 1 }] } })
    expect(positive.tail.expectedDeltaIndex).toBeGreaterThanOrEqual(baseline.tail.expectedDeltaIndex)
  })
})
