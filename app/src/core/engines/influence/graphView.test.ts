import { describe, expect, it } from 'vitest'
import { defaultInfluenceMatrix } from './influence'
import { getTopEdges } from './graphView'

describe('graph top edges', () => {
  it('returns sorted top-N with threshold', () => {
    const edges = getTopEdges(defaultInfluenceMatrix, { topN: 3, threshold: 0.4 })
    expect(edges).toHaveLength(3)
    expect(edges[0].absWeight).toBeGreaterThanOrEqual(edges[1].absWeight)
    expect(edges.every((edge) => edge.absWeight >= 0.4)).toBe(true)
  })

  it('filters by sign and metric labels', () => {
    const positive = getTopEdges(defaultInfluenceMatrix, { sign: 'positive', search: 'сон', topN: 10, threshold: 0 })
    expect(positive.every((edge) => edge.weight > 0)).toBe(true)
    expect(positive.some((edge) => edge.from === 'sleepHours' || edge.to === 'sleepHours')).toBe(true)
  })
})
