import { describe, expect, it } from 'vitest'
import { computeSocialRadar } from './index'
import type { CheckinRecord } from '../../models/checkin'
import type { SocialEventRecord } from '../../models/socialRadar'

function dayTs(offset: number): number {
  return Date.parse('2025-01-01T00:00:00.000Z') + offset * 24 * 60 * 60 * 1000
}

describe('social radar engine', () => {
  it('детерминирован при одинаковом наборе данных', () => {
    const checkins: CheckinRecord[] = Array.from({ length: 30 }).map((_, i) => ({
      ts: dayTs(i),
      energy: 5,
      focus: 5,
      mood: 5,
      stress: 5,
      sleepHours: 7,
      social: 5,
      productivity: 5,
      health: 5,
      cashFlow: 0,
    }))

    const events: SocialEventRecord[] = [{ ts: dayTs(4), dayKey: '2025-01-05', type: 'конфликт', intensity: 4, valence: -2, createdAt: dayTs(4) }]

    const a = computeSocialRadar(checkins, events, [], { windowDays: 30, maxLag: 7 })
    const b = computeSocialRadar(checkins, events, [], { windowDays: 30, maxLag: 7 })

    expect(a.influencesByMetric).toEqual(b.influencesByMetric)
  })

  it('находит лаг=2, когда событие повышает стресс через 2 дня', () => {
    const days = 50
    const events: SocialEventRecord[] = []
    const spikes = new Set([5, 12, 19, 26, 33, 40])
    const checkins: CheckinRecord[] = []

    for (let i = 0; i < days; i += 1) {
      if (spikes.has(i)) {
        events.push({ ts: dayTs(i), dayKey: new Date(dayTs(i)).toISOString().slice(0, 10), type: 'typeA', intensity: 5, valence: 2, createdAt: dayTs(i) })
      }
      const stress = spikes.has(i - 2) ? 8 : 3
      checkins.push({
        ts: dayTs(i),
        energy: 5,
        focus: 5,
        mood: 5,
        stress,
        sleepHours: 7,
        social: 5,
        productivity: 5,
        health: 5,
        cashFlow: 0,
      })
    }

    const result = computeSocialRadar(checkins, events, [], { windowDays: 50, maxLag: 7 })
    const stressTop = result.influencesByMetric.stress[0]
    expect(stressTop).toBeDefined()
    expect(stressTop.key).toContain('typeA')
    expect(stressTop.lag).toBe(2)
    expect(stressTop.sign).toBe('positive')
  })
})
