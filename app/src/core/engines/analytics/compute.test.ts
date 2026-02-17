import { describe, expect, it, vi } from 'vitest'
import { computeAverages, computeIndexSeries, computeStreak, computeWindowDelta } from './compute'
import type { CheckinRecord } from '../../models/checkin'
import { INDEX_METRIC_IDS } from '../../metrics'

const NOW = Date.UTC(2026, 0, 31)
vi.setSystemTime(NOW)

const records: CheckinRecord[] = Array.from({ length: 14 }).map((_, i) => ({
  id: i + 1,
  ts: NOW - i * 86400000,
  energy: i < 7 ? 3 : 6,
  focus: 5,
  mood: 5,
  stress: i < 7 ? 7 : 4,
  sleepHours: 6,
  social: 5,
  productivity: 5,
  health: 5,
  cashFlow: 0,
}))

describe('analytics engine', () => {
  it('computes averages and deltas', () => {
    const avg = computeAverages(records, INDEX_METRIC_IDS, 7)
    const delta = computeWindowDelta(records, INDEX_METRIC_IDS, 7)
    expect(avg.energy).toBeCloseTo(3.375, 3)
    expect(delta.energy).toBeCloseTo(-2.625, 3)
  })

  it('computes streak and index series', () => {
    expect(computeStreak(records)).toBe(14)
    expect(computeIndexSeries(records)).toHaveLength(14)
  })
})
