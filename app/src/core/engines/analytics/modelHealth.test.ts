import { describe, expect, it } from 'vitest'
import { computeBrierScore, computeReliabilityBins, evaluateModelHealth, pageHinkleyDetect } from './modelHealth'

describe('modelHealth', () => {
  it('computes Brier score and reliability bins deterministically', () => {
    const points = [
      { probability: 0.1, outcome: 0 as const },
      { probability: 0.2, outcome: 0 as const },
      { probability: 0.7, outcome: 1 as const },
      { probability: 0.8, outcome: 1 as const },
    ]

    expect(computeBrierScore(points)).toBe(0.045)
    expect(computeReliabilityBins(points, 4)).toEqual([
      { index: 0, left: 0, right: 0.25, count: 2, meanProbability: 0.15, observedRate: 0, gap: 0.15 },
      { index: 1, left: 0.25, right: 0.5, count: 0, meanProbability: 0, observedRate: 0, gap: 0 },
      { index: 2, left: 0.5, right: 0.75, count: 1, meanProbability: 0.7, observedRate: 1, gap: 0.3 },
      { index: 3, left: 0.75, right: 1, count: 1, meanProbability: 0.8, observedRate: 1, gap: 0.2 },
    ])
  })

  it('triggers drift with Page-Hinkley on shift', () => {
    const stable = [0.01, 0.03, 0.02, 0.01, 0.03]
    const shifted = [...stable, 0.6, 0.65, 0.7]

    const stableResult = pageHinkleyDetect(stable)
    expect(stableResult.triggered).toBe(false)
    expect(stableResult.triggerIndex).toBeNull()
    const drift = pageHinkleyDetect(shifted)
    expect(drift.triggered).toBe(true)
    expect(drift.triggerIndex).toBe(5)
  })

  it('returns deterministic health snapshot', () => {
    const input = {
      kind: 'policy' as const,
      calibration: [
        { probability: 0.15, outcome: 0 as const },
        { probability: 0.2, outcome: 0 as const },
        { probability: 0.3, outcome: 1 as const },
        { probability: 0.8, outcome: 1 as const },
        { probability: 0.85, outcome: 1 as const },
      ],
      driftSeries: [0.01, 0.02, 0.01, 0.02, 0.03],
      minSamples: 5,
    }

    const first = evaluateModelHealth(input)
    const second = evaluateModelHealth(input)
    expect(first).toEqual(second)
    expect(first.grade).toBe('yellow')
  })
})
