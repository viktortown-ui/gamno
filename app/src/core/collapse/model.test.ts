import { describe, expect, it } from 'vitest'
import { assessCollapseRisk } from './model'

const snapshot = {
  ts: Date.now(),
  index: 6,
  risk: 30,
  volatility: 1,
  xp: 100,
  level: 2,
  entropy: 20,
  drift: 0,
  stats: { strength: 65, intelligence: 65, wisdom: 65, dexterity: 65 },
}

describe('collapse model', () => {
  it('увеличивает P(collapse) при ухудшении надёжностей', () => {
    const stable = assessCollapseRisk(snapshot, { ts: 1, energy: 8, focus: 8, mood: 8, stress: 2, sleepHours: 8, social: 6, productivity: 8, health: 7, cashFlow: 20000 })
    const degraded = assessCollapseRisk(snapshot, { ts: 1, energy: 3, focus: 3, mood: 3, stress: 9, sleepHours: 4, social: 3, productivity: 3, health: 4, cashFlow: -15000 })
    expect(degraded.pCollapse).toBeGreaterThan(stable.pCollapse)
  })
})
