import { describe, expect, it } from 'vitest'
import type { GoalRecord } from '../../core/models/goal'
import { buildProposedMission, getActiveMission, pickMissionTemplate, resolveWeakLever } from './missionPlanner'

function buildGoal(partial?: Partial<GoalRecord>): GoalRecord {
  return {
    id: 'g-1',
    createdAt: 1,
    updatedAt: 1,
    title: 'Цель',
    horizonDays: 14,
    active: true,
    weights: { focus: 0.8, stress: -0.7 },
    okr: {
      objective: 'Тест',
      keyResults: [
        { id: 'kr-focus', metricId: 'focus', direction: 'up', progress: 0.7 },
        { id: 'kr-stress', metricId: 'stress', direction: 'down', progress: 0.2 },
      ],
    },
    status: 'active',
    ...partial,
  }
}

describe('missionPlanner', () => {
  it('находит слабый рычаг по минимальному прогрессу', () => {
    const weak = resolveWeakLever(buildGoal())
    expect(weak.leverId).toBe('kr-stress')
    expect(weak.metricId).toBe('stress')
  })

  it('детерминированно выбирает шаблон', () => {
    const goal = buildGoal()
    const first = pickMissionTemplate(goal)
    const second = pickMissionTemplate(goal)
    expect(first.id).toBe(second.id)
  })

  it('строит предложенную миссию в нужном статусе и формате', () => {
    const mission = buildProposedMission(buildGoal(), 100)
    expect(mission.status).toBe('suggested')
    expect(mission.effectText.length).toBeGreaterThan(3)
    expect(mission.costMinutes).toBeGreaterThanOrEqual(10)
  })

  it('находит единственную активную миссию', () => {
    const goal = buildGoal({
      missions: [
        { id: 'm1', goalId: 'g-1', leverId: 'kr-focus', title: 'X', why: 'Y', effectText: 'x', costMinutes: 15, status: 'done', createdAt: 1, updatedAt: 1, doneAt: 2 },
        { id: 'm2', goalId: 'g-1', leverId: 'kr-stress', title: 'A', why: 'B', effectText: 'y', costMinutes: 30, status: 'accepted', createdAt: 2, updatedAt: 2 },
      ],
    })
    expect(getActiveMission(goal)?.id).toBe('m2')
  })
})
