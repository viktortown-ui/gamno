import { describe, expect, it } from 'vitest'
import { applyImpulse, defaultInfluenceMatrix } from './influence'
import type { MetricVector } from './types'

describe('influence engine', () => {
  it('propagates deterministically', () => {
    const base: MetricVector = { energy: 5, focus: 5, mood: 5, stress: 5, sleepHours: 7, social: 5, productivity: 5, health: 5, cashFlow: 0 }
    const result = applyImpulse(base, { sleepHours: 1 }, defaultInfluenceMatrix, 2)
    expect(result.energy).toBeGreaterThan(5)
    expect(applyImpulse(base, { sleepHours: 1 }, defaultInfluenceMatrix, 2)).toEqual(result)
  })
})
