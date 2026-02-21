import { describe, expect, it } from 'vitest'
import { buildFrameDiffTop3, buildFrameSnapshot } from './frameEngine'

describe('frameEngine', () => {
  it('детерминирован при одинаковом входе', () => {
    const input = { nowTs: 1000, state: { ts: 1000, index: 6, risk: 2, volatility: 1, entropy: 0.2, drift: 0.1, stats: { strength: 1, intelligence: 1, wisdom: 1, dexterity: 1 }, xp: 10, level: 2 } }
    expect(buildFrameSnapshot(input as never)).toEqual(buildFrameSnapshot(input as never))
  })

  it('diff top3 стабилен', () => {
    const prev = buildFrameSnapshot({ nowTs: 1000, state: { ts: 1000, index: 4, risk: 1, volatility: 1, entropy: 0.2, drift: 0.1, stats: { strength: 1, intelligence: 1, wisdom: 1, dexterity: 1 }, xp: 10, level: 2 }, regime: { ts: 1000, dayKey: 'a', regimeId: 1, pCollapse: 0.1, sirenLevel: 'green', explainTop3: [] } })
    const cur = buildFrameSnapshot({ nowTs: 2000, state: { ts: 2000, index: 8, risk: 3, volatility: 1, entropy: 0.2, drift: 0.1, stats: { strength: 1, intelligence: 1, wisdom: 1, dexterity: 1 }, xp: 10, level: 2 }, regime: { ts: 2000, dayKey: 'b', regimeId: 1, pCollapse: 0.3, sirenLevel: 'amber', explainTop3: [] } })
    const diff = buildFrameDiffTop3(cur, prev)
    expect(diff).toHaveLength(3)
    expect(diff[0]).toContain('Индекс')
  })

  it('tail summary flows from run payload into frame audit snapshot', () => {
    const frame = buildFrameSnapshot({
      nowTs: 3000,
      blackSwan: {
        ts: 2999,
        horizon: 7,
        sims: 500,
        seed: 1,
        weightsSource: 'manual',
        mix: 0,
        summary: { pRed7d: 0.2, esCollapse10: 0.41, sirenLevel: 'red', probEverRed: 0.2, probThresholdEnd: 0.1, esCoreIndex: 4 },
        payload: {
          days: [1],
          coreIndex: { p10: [4], p50: [5], p90: [6] },
          pCollapse: { p10: [0.1], p50: [0.2], p90: [0.3] },
          histogram: [],
          tail: {
            probEverRed: 0.2,
            probThresholdEnd: 0.1,
            probThresholdEver: 0.3,
            esCoreIndex: 4,
            esCollapse: 0.41,
            coreIndexTail: { alpha: 0.9, var: 4, es: 3.5, tailMean: 3.5, tailMass: 0.2, n: 10, method: 'linear-interpolated', warnings: [] },
            collapseTail: { alpha: 0.9, var: 0.35, es: 0.41, tailMean: 0.41, tailMass: 0.2, n: 10, method: 'linear-interpolated', warnings: [] },
          },
          topDrivers: [],
          recommendations: [],
          noteRu: 'test',
        },
      },
    } as never)

    expect(frame.tailRiskSummary.collapseTail?.es).toBe(0.41)
    expect(frame.tailRiskSummary.collapseTail?.method).toBe('linear-interpolated')
  })
})
