import { describe, expect, it } from 'vitest'
import { defaultInfluenceMatrix, explainDriverInsights } from './influence'
import { buildPlaybook, propagateBySteps } from './oracle'
import type { MetricVector } from './types'

const base: MetricVector = {
  energy: 5,
  focus: 5,
  mood: 5,
  stress: 5,
  sleepHours: 7,
  social: 5,
  productivity: 5,
  health: 5,
  cashFlow: 0,
}

describe('oracle deterministic behavior', () => {
  it('keeps propagation deterministic for steps 1..3', () => {
    const one = propagateBySteps(base, { sleepHours: 1, stress: -1 }, defaultInfluenceMatrix, 3)
    const two = propagateBySteps(base, { sleepHours: 1, stress: -1 }, defaultInfluenceMatrix, 3)
    expect(one).toEqual(two)
    expect(one).toHaveLength(3)
  })

  it('sorts drivers by strength descending', () => {
    const result = propagateBySteps(base, { sleepHours: 1.2 }, defaultInfluenceMatrix, 3)[2]
    const drivers = explainDriverInsights(result, base, defaultInfluenceMatrix, 5)
    expect(drivers).toHaveLength(5)
    expect(drivers[0].strength).toBeGreaterThanOrEqual(drivers[1].strength)
  })

  it('builds exactly three deterministic actions', () => {
    const result = propagateBySteps(base, { energy: 0.7, stress: -0.6 }, defaultInfluenceMatrix, 3)[2]
    expect(buildPlaybook(base, result, defaultInfluenceMatrix)).toEqual(buildPlaybook(base, result, defaultInfluenceMatrix))
    expect(buildPlaybook(base, result, defaultInfluenceMatrix)).toHaveLength(3)
  })
})
