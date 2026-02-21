import { describe, expect, it } from 'vitest'
import type { FrameSnapshot } from '../core/frame/frameEngine'
import { runWorldMapWorkerEntry } from './worldMap.worker.entry'

const frame: FrameSnapshot = {
  ts: 1730000000000,
  dayKey: '2026-01-15',
  stateSnapshot: {
    index: 6,
    risk: 5,
    volatility: 2,
    entropy: 1,
    drift: 0,
    stats: { strength: 5, intelligence: 6, wisdom: 5, dexterity: 5 },
    xp: 100,
    level: 4,
  },
  regimeSnapshot: {
    regimeId: 1,
    pCollapse: 0.2,
    sirenLevel: 'green',
    explainTop3: [],
    disarmProtocol: [],
  },
  goal: { goalScore: 2, gap: 0, explainTop3: [] },
  debt: { totalDebt: 10, trend: 'flat', protocol: [] },
  antifragility: { recoveryScore: 0.4, shockBudget: 0.3, antifragilityScore: 0.5 },
  forecastSummary: { p50next7: 6.2, confidence: 'высокая', coverage: 81 },
  tailRiskSummary: { pRed7d: 0.1, esCollapse10: 0.2 },
  multiverseSummary: { branches: [] },
  socialSummary: { topInfluencesWeek: [] },
  autopilotSummary: {},
}

describe('world map worker entry', () => {
  it('returns deterministic snapshot used by worker', () => {
    const first = runWorldMapWorkerEntry({ frame, seed: 5, viewport: { width: 1200, height: 800 } })
    const second = runWorldMapWorkerEntry({ frame, seed: 5, viewport: { width: 1200, height: 800 } })

    expect(first).toEqual(second)
    expect(first.domains.length).toBe(6)
    expect(first.planets.length).toBe(12)
  })
})
