import { describe, expect, it } from 'vitest'
import type { GoalRecord } from '../../models/goal'
import { AUTO_LINK_MIN_ABS_R, AUTO_LINK_MIN_POINTS, buildGoalAutoLinkSuggestions } from './autoLinkSuggestions'

function buildGoal(id: string, points: number[], startDay = 1): GoalRecord {
  return {
    id,
    title: id,
    description: '',
    createdAt: 1,
    updatedAt: 1,
    horizonDays: 14,
    active: true,
    weights: {},
    okr: { objective: '', keyResults: [] },
    status: 'active',
    missionHistory: points.map((cores, index) => ({
      id: `${id}-${index}`,
      goalId: id,
      krKey: 'kr-1',
      title: 'Mission',
      durationDays: 1,
      completedAt: new Date(`2025-01-${String(startDay + index).padStart(2, '0')}T12:00:00.000Z`).getTime(),
      coresAwarded: cores,
    })),
    links: [],
  }
}

describe('buildGoalAutoLinkSuggestions', () => {
  it('returns suggestion for sufficiently strong correlation and enough points', () => {
    const source = buildGoal('goal-1', [1, 3, 2, 4, 5, 5, 6, 8, 7, 9])
    const target = buildGoal('goal-2', [2, 6, 4, 8, 10, 10, 12, 16, 14, 18])

    const result = buildGoalAutoLinkSuggestions(source, [source, target])

    expect(result).toHaveLength(1)
    expect(result[0].targetGoalId).toBe('goal-2')
    expect(result[0].sampleSize).toBeGreaterThanOrEqual(AUTO_LINK_MIN_POINTS)
    expect(Math.abs(result[0].r)).toBeGreaterThanOrEqual(AUTO_LINK_MIN_ABS_R)
    expect(result[0].confidence).toBe('выс')
  })

  it('does not suggest when source has less than minimum points', () => {
    const source = buildGoal('goal-1', [1, 2, 3, 4, 5, 6, 7, 8, 9])
    const target = buildGoal('goal-2', [1, 2, 3, 4, 5, 6, 7, 8, 9])

    const result = buildGoalAutoLinkSuggestions(source, [source, target])

    expect(result).toEqual([])
  })

  it('aligns on union of days and can use zero-filled gaps', () => {
    const source = buildGoal('goal-1', [10, 9, 7, 7, 8, 6, 1, 5, 2, 0], 1)
    const target = buildGoal('goal-2', [1, 8, 4, 2, 10, 7, 3, 5, 4, 9], 3)

    const result = buildGoalAutoLinkSuggestions(source, [source, target])

    expect(result).toHaveLength(1)
    expect(result[0].sampleSize).toBe(12)
  })

  it('skips already linked goals', () => {
    const source = {
      ...buildGoal('goal-1', [1, 3, 2, 4, 5, 5, 6, 8, 7, 9]),
      links: [{ toGoalId: 'goal-2', type: 'supports' as const }],
    }
    const target = buildGoal('goal-2', [2, 6, 4, 8, 10, 10, 12, 16, 14, 18])

    const result = buildGoalAutoLinkSuggestions(source, [source, target])

    expect(result).toEqual([])
  })
})
