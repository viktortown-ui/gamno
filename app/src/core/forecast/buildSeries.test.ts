import { describe, expect, it } from 'vitest'
import { buildDailySeries } from './buildSeries'

describe('buildDailySeries', () => {
  it('строит плотную серию с forward-fill', () => {
    const snapshots = [
      { ts: Date.UTC(2025, 0, 1), index: 50, risk: 20, volatility: 2, entropy: 30, xp: 0, level: 1, drift: 0, stats: { strength: 40, intelligence: 45, wisdom: 41, dexterity: 42 } },
      { ts: Date.UTC(2025, 0, 3), index: 55, risk: 22, volatility: 2.1, entropy: 29, xp: 0, level: 1, drift: 0, stats: { strength: 42, intelligence: 46, wisdom: 43, dexterity: 44 } },
    ]

    const series = buildDailySeries(snapshots, [], 'index')
    expect(series.dates).toEqual(['2025-01-01', '2025-01-02', '2025-01-03'])
    expect(series.values).toEqual([50, 50, 55])
  })
})
