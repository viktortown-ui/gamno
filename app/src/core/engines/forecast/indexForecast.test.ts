import { describe, expect, it } from 'vitest'
import { forecastIndex } from './indexForecast'

describe('forecast engine', () => {
  it('is deterministic', () => {
    const one = forecastIndex([1, 2, 3, 4, 5], 0.4)
    const two = forecastIndex([1, 2, 3, 4, 5], 0.4)
    expect(one).toEqual(two)
    expect(one.values).toHaveLength(7)
  })
})
