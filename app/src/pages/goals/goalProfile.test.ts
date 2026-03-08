import { describe, expect, it } from 'vitest'
import { buildGoalProfile, horizonUrgency } from './goalProfile'
import type { GoalRecord } from '../../core/models/goal'

const baseGoal: GoalRecord = {
  id: 'goal-1',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  title: 'Тестовая цель',
  horizonDays: 14,
  active: true,
  weights: { focus: 0.8, stress: -0.6, energy: 0.5 },
  okr: { objective: 'Сделать рывок', keyResults: [] },
  status: 'active',
  links: [{ toGoalId: 'goal-2', type: 'conflicts' }],
}

describe('goalProfile heuristics', () => {
  it('calculates urgency by horizon buckets', () => {
    expect(horizonUrgency(3)).toBe(100)
    expect(horizonUrgency(7)).toBe(80)
    expect(horizonUrgency(31)).toBe(25)
  })

  it('builds preliminary profile when data is missing', () => {
    const profile = buildGoalProfile({ goal: baseGoal, allGoals: [baseGoal], goalState: null })
    expect(profile.preliminary).toBe(true)
    expect(profile.inactionCost).toBeGreaterThan(0)
    expect(profile.warnings.some((item) => item.includes('предварительная'))).toBe(true)
  })
})
