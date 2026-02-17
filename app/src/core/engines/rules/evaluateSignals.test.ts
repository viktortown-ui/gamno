import { describe, expect, it } from 'vitest'
import { evaluateSignals } from './evaluateSignals'

describe('rules engine', () => {
  it('returns expected signals', () => {
    const signals = evaluateSignals({ energyAvg7d: 2.5, stressAvg7d: 8, sleepAvg7d: 5.5, indexDelta7d: -1.2 })
    expect(signals.map((s) => s.id)).toEqual(['risk-breakdown', 'sleep-debt', 'index-drop'])
  })
})
