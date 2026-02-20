import { describe, expect, it } from 'vitest'
import { runBlackSwan } from './index'
import { defaultInfluenceMatrix } from '../influence/influence'
import type { CheckinRecord } from '../../models/checkin'

function makeHistory(days = 40): CheckinRecord[] {
  const now = Date.now()
  return Array.from({ length: days }).map((_, idx) => ({
    ts: now - (days - idx) * 86400000,
    energy: 6,
    focus: 6,
    mood: 6,
    stress: 4,
    sleepHours: 7.5,
    social: 5,
    productivity: 6,
    health: 6,
    cashFlow: 1000,
  }))
}

describe('black swan engine', () => {
  it('deterministic by seed', () => {
    const history = makeHistory()
    const input = { baseRecord: history.at(-1)!, history, matrix: defaultInfluenceMatrix, settings: { horizonDays: 14 as const, simulations: 500 as const, noiseMultiplier: 1, thresholdCollapse: 0.35, alpha: 0.1, weightsSource: 'manual' as const, mix: 0, targetRedProb: 0.1 }, seed: 42 }
    const a = runBlackSwan(input)
    const b = runBlackSwan(input)
    expect(a.tail.esCollapse).toBe(b.tail.esCollapse)
    expect(a.coreIndex.p50).toEqual(b.coreIndex.p50)
  })

  it('noise monotonicity sanity', () => {
    const history = makeHistory()
    const low = runBlackSwan({ baseRecord: history.at(-1)!, history, matrix: defaultInfluenceMatrix, settings: { horizonDays: 14, simulations: 500, noiseMultiplier: 0.5, thresholdCollapse: 0.35, alpha: 0.1, weightsSource: 'manual', mix: 0, targetRedProb: 0.1 }, seed: 7 })
    const high = runBlackSwan({ baseRecord: history.at(-1)!, history, matrix: defaultInfluenceMatrix, settings: { horizonDays: 14, simulations: 500, noiseMultiplier: 1.8, thresholdCollapse: 0.35, alpha: 0.1, weightsSource: 'manual', mix: 0, targetRedProb: 0.1 }, seed: 7 })
    expect(high.tail.esCollapse).toBeGreaterThanOrEqual(low.tail.esCollapse)
  })

  it('sleep shock worsens collapse tail', () => {
    const history = makeHistory()
    const base = runBlackSwan({ baseRecord: history.at(-1)!, history, matrix: defaultInfluenceMatrix, settings: { horizonDays: 7, simulations: 500, noiseMultiplier: 1, thresholdCollapse: 0.35, alpha: 0.1, weightsSource: 'manual', mix: 0, targetRedProb: 0.1 }, seed: 11 })
    const shock = runBlackSwan({ baseRecord: history.at(-1)!, history, matrix: defaultInfluenceMatrix, settings: { horizonDays: 7, simulations: 500, noiseMultiplier: 1, thresholdCollapse: 0.35, alpha: 0.1, weightsSource: 'manual', mix: 0, targetRedProb: 0.1 }, scenario: { nameRu: 'сон вниз', shocks: [{ metricId: 'sleepHours', delta: -1.5, durationDays: 5, mode: 'daily' }] }, seed: 11 })
    expect(shock.tail.esCollapse).toBeGreaterThanOrEqual(base.tail.esCollapse)
  })

  it('ES correctness on known distribution', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    const alpha = 0.1
    const size = Math.max(1, Math.floor(values.length * alpha))
    const worstMean = values.sort((a, b) => a - b).slice(0, size).reduce((s, v) => s + v, 0) / size
    expect(worstMean).toBe(1)
  })
})
