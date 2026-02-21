import { describe, expect, it } from 'vitest'
import { buildFrameSnapshot } from '../core/frame/frameEngine'
import type { WorldMapSnapshot } from '../core/worldMap/types'
import { buildWorldFxEvents, mapFrameToHudSignals } from './worldCockpit'

function makeFrame(ts: number, overrides?: Partial<ReturnType<typeof buildFrameSnapshot>>) {
  return {
    ...buildFrameSnapshot({ nowTs: ts }),
    ...overrides,
  }
}

describe('worldCockpit helpers', () => {
  it('maps HUD signals deterministically with stable order', () => {
    const frame = makeFrame(1000, {
      regimeSnapshot: { regimeId: 1, pCollapse: 0.211, sirenLevel: 'amber', explainTop3: [], disarmProtocol: ['x'] },
      tailRiskSummary: { pRed7d: 0.2, esCollapse10: 0.153 },
      goal: { active: { title: 'Миссия А' }, goalScore: 0, gap: 0, explainTop3: [] },
    })

    const one = mapFrameToHudSignals({ frame, mode: 'balanced', failRate: 0.07, trust: { grade: 'yellow', reasonsRu: ['Калибровка умеренная.'] } })
    const two = mapFrameToHudSignals({ frame, mode: 'balanced', failRate: 0.07, trust: { grade: 'yellow', reasonsRu: ['Калибровка умеренная.'] } })

    expect(one).toEqual(two)
    expect(one.map((item) => item.key)).toEqual(['mode', 'safety', 'collapse', 'es', 'failRate', 'mission', 'trust'])
    expect(one[1]?.value).toContain('SafeMode')
  })

  it('builds deterministic FX events from deterministic diff', () => {
    const previous = makeFrame(1000, {
      stateSnapshot: { index: 10, risk: 0.3, volatility: 0.2, entropy: 0, drift: 0, stats: { strength: 0, intelligence: 0, wisdom: 0, dexterity: 0 }, xp: 0, level: 1 },
      regimeSnapshot: { regimeId: 1, pCollapse: 0.1, sirenLevel: 'green', explainTop3: ['x'], disarmProtocol: ['hold'] },
      goal: { active: { title: 'A' }, goalScore: 10, gap: 0, explainTop3: [] },
      debt: { totalDebt: 1, trend: 'flat', protocol: [] },
      forecastSummary: { p50next7: 20, confidence: 'низкая', coverage: 0 },
      tailRiskSummary: { pRed7d: 0.2, esCollapse10: 0.1 },
      socialSummary: { topInfluencesWeek: ['A'] },
    })
    const current = makeFrame(2000, {
      stateSnapshot: { index: 14, risk: 0.8, volatility: 0.2, entropy: 0, drift: 0, stats: { strength: 0, intelligence: 0, wisdom: 0, dexterity: 0 }, xp: 0, level: 2 },
      regimeSnapshot: { regimeId: 1, pCollapse: 0.25, sirenLevel: 'red', explainTop3: [], disarmProtocol: [] },
      goal: { active: { title: 'B' }, goalScore: 12, gap: 0, explainTop3: [] },
      debt: { totalDebt: 2, trend: 'up', protocol: [] },
      forecastSummary: { p50next7: 25, confidence: 'средняя', coverage: 70 },
      tailRiskSummary: { pRed7d: 0.2, esCollapse10: 0.2 },
      socialSummary: { topInfluencesWeek: ['B'] },
    })

    const snapshot: WorldMapSnapshot = {
      id: 's',
      ts: 2000,
      seed: 12,
      viewport: { width: 1000, height: 600, padding: 24 },
      center: { x: 500, y: 300 },
      metrics: { level: 1, risk: 0.1, esCollapse10: 0.1, failProbability: 0.1, budgetPressure: 0.1, safeMode: false, sirenLevel: 'green' },
      rings: [],
      storms: [],
      domains: [],
      planets: [
        { id: 'planet:core', domainId: 'core', order: 0, labelRu: 'core', weight: 0, importance: 0, radius: 10, x: 1, y: 1, angle: 0, metrics: { level: 1, risk: 0.1, esCollapse10: 0.1, failProbability: 0.1, budgetPressure: 0.1, safeMode: false, sirenLevel: 'green' }, renderHints: { hasStorm: false, stormStrength: 0.1, tailRisk: 0.1, drawTailGlow: false } },
        { id: 'planet:risk', domainId: 'risk', order: 1, labelRu: 'risk', weight: 0, importance: 0, radius: 10, x: 1, y: 1, angle: 0, metrics: { level: 1, risk: 0.1, esCollapse10: 0.1, failProbability: 0.1, budgetPressure: 0.1, safeMode: false, sirenLevel: 'green' }, renderHints: { hasStorm: false, stormStrength: 0.1, tailRisk: 0.1, drawTailGlow: false } },
      ],
    }

    const one = buildWorldFxEvents({ current, previous, snapshot })
    const two = buildWorldFxEvents({ current, previous, snapshot })
    expect(one).toEqual(two)
    expect(one.some((item) => item.type === 'pulse')).toBe(true)
    expect(one.some((item) => item.type === 'burst')).toBe(true)
    expect(one.some((item) => item.type === 'storm')).toBe(true)
  })
})
