import { describe, expect, it } from 'vitest'
import { selectBestLever } from './suggestions'
import { defaultInfluenceMatrix } from '../influence/influence'

const sampleCheckin = {
  ts: 1700000000000,
  energy: 5,
  focus: 5,
  mood: 5,
  stress: 6,
  sleepHours: 6,
  social: 5,
  productivity: 5,
  health: 5,
  cashFlow: 0,
}

describe('suggestions', () => {
  it('selects deterministic best lever', () => {
    const first = selectBestLever(sampleCheckin, defaultInfluenceMatrix)
    const second = selectBestLever(sampleCheckin, defaultInfluenceMatrix)

    expect(first).toBeTruthy()
    expect(second).toEqual(first)
  })
})
