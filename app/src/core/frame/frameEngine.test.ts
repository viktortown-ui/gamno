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
})
