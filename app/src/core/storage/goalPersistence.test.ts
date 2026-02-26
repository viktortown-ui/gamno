import { beforeEach, describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'

;(globalThis as unknown as { self: typeof globalThis }).self = globalThis

describe('goals persistence', () => {
  beforeEach(async () => {
    const { clearAllData } = await import('./repo')
    await clearAllData()
  })

  it('создаёт, активирует и обновляет цель', async () => {
    const { createGoal, getActiveGoal, listGoals, setActiveGoal, updateGoal } = await import('./repo')

    const first = await createGoal({
      title: 'Фокус без перегруза',
      description: 'Снизить риск и удержать продуктивность.',
      horizonDays: 14,
      weights: { stress: -0.8, focus: 0.7 },
      targetIndex: 7,
      targetPCollapse: 0.2,
      constraints: { maxPCollapse: 0.25, sirenCap: 'amber', maxEntropy: 6 },
      status: 'draft',
    })

    const second = await createGoal({
      title: 'Стабильный сон',
      horizonDays: 7,
      weights: { sleepHours: 0.7, stress: -0.6 },
      status: 'draft',
    })

    await setActiveGoal(second.id)
    await updateGoal(second.id!, { description: 'Режим сна 7 дней', constraints: { maxPCollapse: 0.22 } })

    const active = await getActiveGoal()
    const all = await listGoals()

    expect(active?.id).toBe(second.id)
    expect(active?.status).toBe('active')
    expect(all).toHaveLength(2)
    expect(all.find((item) => item.id === first.id)?.status).toBe('draft')
  })

  it('делает roundtrip событий цели в fake-indexeddb', async () => {
    const { addGoalEvent, createGoal, listGoalEvents } = await import('./repo')
    const goal = await createGoal({
      title: 'Удержать курс',
      horizonDays: 30,
      weights: { energy: 0.6, stress: -0.9 },
      status: 'active',
    })

    await addGoalEvent({ goalId: goal.id, goalScore: 55.1, goalGap: -14.9, ts: 1000 })
    await addGoalEvent({ goalId: goal.id, goalScore: 61.2, goalGap: -8.8, ts: 2000 })

    const rows = await listGoalEvents(goal.id, 5)
    expect(rows).toHaveLength(2)
    expect(rows[0].goalScore).toBe(61.2)
    expect(rows[1].goalScore).toBe(55.1)
  })

  it('сохраняет KR прогресс и активную миссию', async () => {
    const { createGoal, updateGoal, listGoals } = await import('./repo')

    const goal = await createGoal({
      title: 'Тест KR и миссии',
      horizonDays: 14,
      status: 'active',
      weights: { focus: 0.6, stress: -0.5 },
      okr: {
        objective: 'Проверить persistence',
        keyResults: [{ id: 'kr-focus', metricId: 'focus', direction: 'up', progressMode: 'manual', progress: 0.4 }],
      },
    })

    await updateGoal(goal.id, {
      activeMission: {
        id: 'mission-1',
        createdAt: 100,
        horizonDays: 3,
        actions: [{ id: 'a1', title: 'Сделать шаг', metricId: 'focus', krId: 'kr-focus', done: true }],
        completedAt: 200,
        rewardBadge: '🍎 Плод миссии: 1/1',
      },
      fruitBadge: '🍎 Плод миссии',
    })

    const rows = await listGoals()
    expect(rows[0].okr.keyResults[0].progress).toBe(0.4)
    expect(rows[0].activeMission?.actions).toHaveLength(1)
    expect(rows[0].activeMission?.rewardBadge).toContain('Плод')
    expect(rows[0].fruitBadge).toContain('Плод')
  })
})
