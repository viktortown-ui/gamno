import { describe, expect, it } from 'vitest'
import type { FrameSnapshot } from '../frame/frameEngine'
import { buildWorldMapSnapshot } from './buildWorldMapSnapshot'

function buildFrame(): FrameSnapshot {
  return {
    ts: 1730000000000,
    dayKey: '2026-01-15',
    stateSnapshot: {
      index: 6.2,
      risk: 4.8,
      volatility: 2.1,
      entropy: 0.9,
      drift: 0.2,
      stats: { strength: 6, intelligence: 7, wisdom: 5, dexterity: 6 },
      xp: 240,
      level: 5,
    },
    regimeSnapshot: {
      regimeId: 1,
      pCollapse: 0.27,
      sirenLevel: 'amber',
      explainTop3: ['a'],
      disarmProtocol: ['b'],
      next1: [0.4, 0.6],
      next3: [0.5, 0.5],
    },
    goal: {
      active: { id: 1, title: 'Фокус' },
      goalScore: 3.2,
      gap: -4,
      explainTop3: [],
    },
    mission: { id: 2, title: 'Спринт', status: 'active' },
    debt: { totalDebt: 24, trend: 'up', protocol: [] },
    antifragility: { recoveryScore: 0.62, shockBudget: 0.34, antifragilityScore: 0.58 },
    forecastSummary: { p50next7: 6.5, confidence: 'средняя', coverage: 66 },
    tailRiskSummary: { pRed7d: 0.23, esCollapse10: 0.31, cvar: 0.28 },
    multiverseSummary: { branches: [{ nameRu: 'base', probability: 0.5 }], chosenBranch: 'base' },
    socialSummary: { topInfluencesWeek: ['сон'] },
    autopilotSummary: { policy: 'balanced', nextAction: 'focus:deep-25' },
  }
}

describe('buildWorldMapSnapshot', () => {
  it('is deterministic for same frame+seed+viewport', () => {
    const frame = buildFrame()
    const first = buildWorldMapSnapshot(frame, 19, { width: 1280, height: 720 })
    const second = buildWorldMapSnapshot(frame, 19, { width: 1280, height: 720 })
    expect(second).toEqual(first)
  })

  it('keeps stable fixed ordering for domains and planets', () => {
    const frame = buildFrame()
    const map = buildWorldMapSnapshot(frame, 19, { width: 1280, height: 720 })

    expect(map.domains.map((item) => item.id)).toEqual(['core', 'risk', 'mission', 'stability', 'forecast', 'social'])
    expect(map.planets.map((item) => item.id)).toEqual([
      'planet:core:0', 'planet:core:1',
      'planet:risk:0', 'planet:risk:1',
      'planet:mission:0', 'planet:mission:1',
      'planet:stability:0', 'planet:stability:1',
      'planet:forecast:0', 'planet:forecast:1',
      'planet:social:0', 'planet:social:1',
    ])
  })

  it('does not emit NaN/Infinity values in layout', () => {
    const frame = buildFrame()
    const map = buildWorldMapSnapshot(frame, 7, { width: 900, height: 600 })
    const numericValues = [
      map.center.x,
      map.center.y,
      ...map.rings.flatMap((ring) => [ring.radius, ring.width, ring.stormStrength]),
      ...map.planets.flatMap((planet) => [planet.x, planet.y, planet.radius, planet.angle, planet.weight, planet.importance]),
    ]

    for (const value of numericValues) {
      expect(Number.isFinite(value)).toBe(true)
    }
  })

  it('keeps snapshot compact enough for persistence sanity', () => {
    const frame = buildFrame()
    const map = buildWorldMapSnapshot(frame, 13, { width: 1024, height: 768 })
    const size = JSON.stringify(map).length

    expect(size).toBeLessThan(20_000)
  })
})
