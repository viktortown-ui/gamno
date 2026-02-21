import { describe, expect, it } from 'vitest'
import { compactTailRiskSummary, computeTailRisk } from './tailRisk'

describe('computeTailRisk', () => {
  it('computes deterministic VaR/ES with fixed method', () => {
    const sample = [1, 2, 3, 4, 5, 6, 7, 8]
    const a = computeTailRisk(sample, 0.75)
    const b = computeTailRisk(sample, 0.75)
    expect(a).toEqual(b)
    expect(a.var).toBe(6.25)
    expect(a.es).toBeCloseTo(7.5, 10)
    expect(a.method).toBe('linear-interpolated')
  })

  it('handles empty and non-finite samples safely', () => {
    const empty = computeTailRisk([])
    expect(empty.n).toBe(0)
    expect(empty.warnings).toContain('empty-sample')

    const dirty = computeTailRisk([1, Number.NaN, Number.POSITIVE_INFINITY, 4], 0.9)
    expect(dirty.n).toBe(2)
    expect(dirty.warnings).toContain('dropped-non-finite')
    expect(dirty.es).toBeGreaterThanOrEqual(dirty.var)
  })

  it('builds compact serializable summary', () => {
    const compact = compactTailRiskSummary(computeTailRisk([0.1, 0.2, 0.7, 0.9], 0.8))
    expect(compact).toEqual(JSON.parse(JSON.stringify(compact)))
    expect(compact.n).toBe(4)
  })
})
