import { describe, expect, it } from 'vitest'
import { getBinPointsPath } from './CalibrationTrust.utils'

describe('CalibrationTrust', () => {
  it('maps bins to SVG points in deterministic index order', () => {
    const bins = [
      { index: 2, left: 0.2, right: 0.3, count: 3, meanProbability: 0.25, observedRate: 0.5, gap: 0.25 },
      { index: 0, left: 0, right: 0.1, count: 3, meanProbability: 0.05, observedRate: 0.1, gap: 0.05 },
      { index: 1, left: 0.1, right: 0.2, count: 3, meanProbability: 0.15, observedRate: 0.2, gap: 0.05 },
    ]

    expect(getBinPointsPath(bins)).toBe('M 41.67 82.00 L 105.00 74.00 L 168.33 50.00')
  })
})
