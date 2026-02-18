import { describe, expect, it } from 'vitest'
import type { CheckinRecord } from '../models/checkin'
import type { QuestRecord } from '../models/quest'
import { computeCoreState, explainCoreState } from './stateEngine'

const checkins: CheckinRecord[] = [
  {
    ts: 1700000000000,
    energy: 8,
    focus: 7,
    mood: 7,
    stress: 3,
    sleepHours: 7.5,
    social: 6,
    productivity: 8,
    health: 7,
    cashFlow: 12000,
  },
  {
    ts: 1699913600000,
    energy: 5,
    focus: 6,
    mood: 6,
    stress: 5,
    sleepHours: 6.5,
    social: 5,
    productivity: 6,
    health: 6,
    cashFlow: 9000,
  },
]

const quests: QuestRecord[] = [
  {
    id: 1,
    createdAt: 1699900000000,
    title: 'Стабильный утренний фокус',
    metricTarget: 'focus',
    delta: 1,
    horizonDays: 3,
    status: 'completed',
    predictedIndexLift: 1.8,
    completedAt: 1700000000000,
    xpEarned: 16,
    outcomeRu: 'Выполнено.',
  },
]

describe('state engine', () => {
  it('детерминированно считает статы и прогресс', () => {
    const snapshot = computeCoreState(checkins, quests, 1700000000001)
    const repeated = computeCoreState(checkins, quests, 1700000000001)

    expect(snapshot).toEqual(repeated)
    expect(snapshot.ts).toBe(1700000000001)
    expect(snapshot.stats.strength).toBeGreaterThan(70)
    expect(snapshot.stats.intelligence).toBeGreaterThan(70)
    expect(snapshot.stats.wisdom).toBeGreaterThan(65)
    expect(snapshot.stats.dexterity).toBeGreaterThan(70)
    expect(snapshot.xp).toBeGreaterThan(300)
    expect(snapshot.level).toBeGreaterThanOrEqual(2)
    expect(snapshot.index).toBeGreaterThan(6)
    expect(snapshot.risk).toBeLessThan(40)
  })

  it('дает базовое состояние без данных', () => {
    const snapshot = computeCoreState([], [], 1700000000002)

    expect(snapshot.stats.strength).toBeGreaterThan(40)
    expect(snapshot.level).toBe(1)
    expect(snapshot.xp).toBeGreaterThanOrEqual(0)
    expect(snapshot.index).toBe(0)
  })

  it('объясняет ядро через топ-вкладчики', () => {
    const contributors = explainCoreState(checkins[0], checkins[1], quests[0])

    expect(contributors).toHaveLength(3)
    expect(contributors[0].title).toBe('Энергия')
    expect(contributors.some((item) => item.id === 'quest-driver')).toBe(true)
  })
})
