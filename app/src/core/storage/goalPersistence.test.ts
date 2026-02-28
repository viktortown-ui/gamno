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

  it('сохраняет KR прогресс, активную миссию и историю плодов', async () => {
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
        goalId: goal.id,
        krKey: 'kr-focus',
        title: 'Ритуал фокуса',
        durationDays: 3,
        startedAt: 100,
        endsAt: 300,
        expectedMin: 3,
        expectedMax: 8,
        expectedDefault: 5,
      },
      missionHistory: [{
        id: 'fruit-1',
        goalId: goal.id,
        krKey: 'kr-focus',
        title: 'Ритуал фокуса',
        durationDays: 3,
        completedAt: 200,
        coresAwarded: 6,
      }],
    })

    const rows = await listGoals()
    expect(rows[0].okr.keyResults[0].progress).toBe(0.4)
    expect(rows[0].activeMission?.expectedDefault).toBe(5)
    expect(rows[0].missionHistory).toHaveLength(1)
    expect(rows[0].missionHistory?.[0].coresAwarded).toBe(6)
  })

  it('сохраняет режим пресета и ручную настройку', async () => {
    const { createGoal, updateGoal, listGoals } = await import('./repo')

    const goal = await createGoal({
      title: 'Режимы цели',
      horizonDays: 14,
      status: 'active',
      modePresetId: 'recovery',
      isManualTuning: false,
      weights: { sleepHours: 0.9, energy: 0.8, stress: -0.9 },
      okr: { objective: 'Восстановление', keyResults: [] },
    })

    await updateGoal(goal.id, {
      isManualTuning: true,
      modePresetId: undefined,
      manualTuning: {
        weights: { focus: 0.7, productivity: 0.6, stress: -0.4 },
        horizonDays: 7,
      },
    })

    const rows = await listGoals()
    expect(rows[0].isManualTuning).toBe(true)
    expect(rows[0].modePresetId).toBeUndefined()
    expect(rows[0].manualTuning?.weights.focus).toBe(0.7)
    expect(rows[0].manualTuning?.horizonDays).toBe(7)
  })
})
