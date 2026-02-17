import { describe, expect, it } from 'vitest'
import type { CheckinRecord } from './types'
import {
  computeAverages,
  computeDelta,
  computeIndexTrend,
  computeStreak,
  computeTopMovers,
  computeVolatility,
  getRange,
} from './compute'
import { evaluateSignals } from './rules'
import { INDEX_METRIC_IDS } from '../../metrics'

const DAY_MS = 24 * 60 * 60 * 1000
const NOW_TS = Date.UTC(2026, 0, 16, 12, 0, 0)

function buildFixtures(): CheckinRecord[] {
  return Array.from({ length: 15 }).map((_, i) => ({
    id: i + 1,
    ts: NOW_TS - i * DAY_MS,
    energy: i <= 6 ? 2 : 6,
    focus: i <= 6 ? 4 : 7,
    mood: i <= 6 ? 4 : 7,
    stress: i <= 6 ? 8 : 4,
    sleepHours: i <= 6 ? 5 : 7,
    social: i <= 6 ? 4 : 7,
    productivity: i <= 6 ? 4 : 7,
    health: i <= 6 ? 4 : 7,
    cashFlow: i <= 6 ? 100 : 200,
  }))
}

describe('analytics compute', () => {
  const fixtures = buildFixtures()

  it('computes 7-day averages and deltas against previous window', () => {
    const last7 = getRange(fixtures, 7, NOW_TS)
    const prev7 = fixtures.filter((item) => item.ts < NOW_TS - 7 * DAY_MS && item.ts >= NOW_TS - 14 * DAY_MS)
    const currentAvg = computeAverages(last7, INDEX_METRIC_IDS)
    const previousAvg = computeAverages(prev7, INDEX_METRIC_IDS)
    const delta = computeDelta(currentAvg, previousAvg)

    expect(currentAvg.energy).toBe(2.5)
    expect(previousAvg.energy).toBe(6)
    expect(delta.energy).toBe(-3.5)
  })

  it('calculates index trend and streak', () => {
    const trend = computeIndexTrend(fixtures, 7, NOW_TS)
    const streak = computeStreak(fixtures)

    expect(trend.currentAvg).toBeCloseTo(4.640625, 3)
    expect(trend.previousAvg).toBeCloseTo(6.5, 3)
    expect(trend.delta).toBeCloseTo(-1.859375, 3)
    expect(trend.direction).toBe('down')
    expect(streak).toBe(15)
  })

  it('returns top movers and volatility', () => {
    const top = computeTopMovers({ energy: -4, stress: 4, focus: -3, mood: -3 }, 3)
    const volatility = computeVolatility(fixtures, 'energy', 14, NOW_TS)

    expect(top).toHaveLength(3)
    expect(top[0].metricId).toBe('energy')
    expect(volatility).toBeCloseTo(1.03, 2)
  })

  it('returns rule signals for low energy/high stress and index drop', () => {
    const signals = evaluateSignals(fixtures, NOW_TS)
    expect(signals.map((item) => item.severity)).toEqual(['red', 'yellow', 'yellow'])
    expect(signals[0].titleRu).toContain('Критический')
  })
})
