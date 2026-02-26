import { describe, expect, it } from 'vitest'
import { canonicalMetricId, sanitizeGraphData } from './graphDataSanitizer'

describe('graphDataSanitizer', () => {
  it('normalizes metric ids from RU labels and drops invalid links', () => {
    const nodes = [
      { id: 'focus', label: 'Фокус' },
      { id: 'energy', label: 'Энергия' },
    ]
    const links = [
      { source: 'Фокус', target: 'energy', weight: 0.4 },
      { source: 'missing', target: 'focus', weight: 0.1 },
      { source: { id: 'Энергия' }, target: { id: 'focus' }, weight: 0.2 },
    ]

    const result = sanitizeGraphData(nodes, links, canonicalMetricId)

    expect(result.links).toEqual([
      { source: 'focus', target: 'energy', weight: 0.4 },
      { source: 'energy', target: 'focus', weight: 0.2 },
    ])
    expect(result.droppedLinksCount).toBe(1)
    expect(result.droppedExamples).toHaveLength(1)
  })
})
