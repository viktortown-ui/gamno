import { describe, expect, it } from 'vitest'
import { bootstrapIntervals } from './bootstrap'
import { fitBestEts } from './ets'

describe('bootstrap intervals', () => {
  it('выдает детерминированные квантильные ряды при одном seed', () => {
    const fit = fitBestEts([50, 51, 52, 53, 54, 55, 56])
    const one = bootstrapIntervals(fit, 5, 200, 123)
    const two = bootstrapIntervals(fit, 5, 200, 123)

    expect(one.p10).toEqual(two.p10)
    expect(one.p50).toEqual(two.p50)
    expect(one.p90).toEqual(two.p90)
  })
})
