import { describe, expect, it } from 'vitest'
import type { GoalRecord } from '../../core/models/goal'
import { buildGoalRootSceneModel } from './goalRootScene'
import type { GoalProfile } from './goalProfile'

const goalA: GoalRecord = {
  id: 'g-a',
  title: 'Главная цель',
  description: 'desc',
  horizonDays: 14,
  active: true,
  status: 'active',
  template: 'growth',
  weights: { focus: 0.8, stress: -0.5 },
  links: [
    { toGoalId: 'g-b', type: 'supports' },
    { toGoalId: 'g-c', type: 'depends_on' },
    { toGoalId: 'g-d', type: 'conflicts' },
  ],
  okr: { objective: 'obj', keyResults: [] },
  createdAt: Date.now(),
  updatedAt: Date.now(),
}

const baseProfile: GoalProfile = {
  id: 'g-a',
  title: 'Главная цель',
  status: 'active',
  importance: 70,
  horizonDays: 14,
  successValue: 65,
  failCost: 60,
  timeCost: 50,
  energyCost: 45,
  debtCost: 40,
  riskScore: 48,
  linkageScore: 60,
  conflictScore: 40,
  supportScore: 58,
  progressScore: 55,
  momentumScore: 53,
  inactionCost: 57,
  blockers: ['Нестабильный слот времени'],
  supporters: ['Утренний ритм'],
  dependencies: ['Режим сна'],
  conflicts: ['Параллельная цель'],
  warnings: [],
  diagnosis: {
    weakSpot: 'Фокус',
    why: 'Шум',
    mainBlocker: 'Нестабильный слот времени',
    mainSupport: 'Утренний ритм',
    mainConflict: 'Параллельная цель',
    confidence: 'medium',
  },
  prognosis: {
    idle: { riskDelta: 1, debtDelta: 1, momentumDelta: -1, verdict: 'v' },
    takeStep: { riskDelta: -1, debtDelta: -1, momentumDelta: 2, verdict: 'v' },
    delay3d: { riskDelta: 1, debtDelta: 1, momentumDelta: -1, verdict: 'v' },
  },
  decision: {
    actionTitle: 'Стабилизировать утренний слот',
    whyBest: 'w',
    effect: 'e',
    timeCostLabel: '20',
    energyCostLabel: 'низко',
    sideEffect: 's',
  },
  constraints: [],
  branches: [],
  preliminary: false,
}

describe('buildGoalRootSceneModel', () => {
  it('builds mode-specific map with pressure node and execution step', () => {
    const model = buildGoalRootSceneModel({
      selectedGoal: goalA,
      allGoals: [goalA, { ...goalA, id: 'g-b', title: 'Опора', links: [] }, { ...goalA, id: 'g-c', title: 'Зависимость', links: [] }, { ...goalA, id: 'g-d', title: 'Конфликт', links: [] }],
      profile: baseProfile,
      mode: 'execution',
      debtTotal: 2.5,
      blackSwanRisk: 0.3,
      hasSocialInsight: true,
    })

    expect(model).toBeTruthy()
    expect(model?.nodes.some((node) => node.type === 'helps')).toBe(true)
    expect(model?.nodes.some((node) => node.type === 'blocks')).toBe(true)
    expect(model?.nodes.some((node) => node.type === 'depends_on')).toBe(true)
    expect(model?.nodes.some((node) => node.type === 'conflicts_with')).toBe(false)
    expect(model?.pressureNodeId).toBeTruthy()
    expect(model?.nodes.some((node) => node.isNextStep)).toBe(true)
  })
})
