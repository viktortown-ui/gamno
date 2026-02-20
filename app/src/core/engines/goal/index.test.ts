import { describe, expect, it } from 'vitest'
import { defaultInfluenceMatrix } from '../influence/influence'
import { evaluateGoalScore, suggestGoalActions, type GoalStateInput } from './index'
import type { GoalRecord } from '../../models/goal'

const goal: GoalRecord = {
  id: 1,
  createdAt: 1,
  updatedAt: 1,
  title: 'Устойчивый рост',
  horizonDays: 14,
  weights: {
    energy: 0.8,
    stress: -0.9,
    sleepHours: 0.4,
    productivity: 0.5,
  },
  targetIndex: 7,
  targetPCollapse: 0.2,
  constraints: { maxEntropy: 6, maxPCollapse: 0.25, sirenCap: 'amber' },
  status: 'active',
}

const baseState: GoalStateInput = {
  index: 6.2,
  pCollapse: 0.28,
  entropy: 6.4,
  drift: -0.2,
  stats: { strength: 58, intelligence: 60, wisdom: 55, dexterity: 57 },
  metrics: {
    energy: 5,
    focus: 6,
    mood: 6,
    stress: 7,
    sleepHours: 6,
    social: 5,
    productivity: 6,
    health: 6,
    cashFlow: 0,
  },
  forecast: { p10: 5.5, p50: 6.1, p90: 6.8 },
}

describe('goal engine', () => {
  it('детерминированно считает score/gap и top3', () => {
    const first = evaluateGoalScore(goal, baseState)
    const second = evaluateGoalScore(goal, baseState)

    expect(first.goalScore).toBe(second.goalScore)
    expect(first.goalGap).toBe(second.goalGap)
    expect(first.explainTop3).toEqual(second.explainTop3)
    expect(first.goalScore).toBeGreaterThanOrEqual(0)
    expect(first.goalScore).toBeLessThanOrEqual(100)
    expect(first.explainTop3).toHaveLength(3)
  })

  it('монотонность: лучше индекс и ниже pCollapse дают больший score', () => {
    const worse = evaluateGoalScore(goal, baseState)
    const better = evaluateGoalScore(goal, {
      ...baseState,
      index: baseState.index + 0.8,
      pCollapse: baseState.pCollapse - 0.12,
    })

    expect(better.goalScore).toBeGreaterThan(worse.goalScore)
  })

  it('возвращает 3 лучших действия c ожидаемым приростом', () => {
    const actions = suggestGoalActions(goal, baseState, defaultInfluenceMatrix)
    expect(actions).toHaveLength(3)
    expect(actions[0].deltaGoalScore).toBeGreaterThanOrEqual(actions[1].deltaGoalScore)
    expect(actions[1].deltaGoalScore).toBeGreaterThanOrEqual(actions[2].deltaGoalScore)
  })
})
