import { describe, expect, it } from 'vitest'
import { getTransitionMatrix, predictNext, regimeFromDay } from './model'

describe('regime model', () => {
  it('детерминированно классифицирует день', () => {
    const input = { dayIndex: 72, volatility: 20, stress: 3, sleepHours: 8, energy: 8, mood: 7, prevDayIndex: 70 }
    expect(regimeFromDay(input)).toBe(regimeFromDay(input))
  })

  it('покрывает пороговые случаи', () => {
    expect(regimeFromDay({ dayIndex: 35, volatility: 10, stress: 6, sleepHours: 5, energy: 3, mood: 4 })).toBe(3)
    expect(regimeFromDay({ dayIndex: 60, volatility: 75, stress: 8, sleepHours: 4, energy: 3, mood: 3 })).toBe(4)
  })

  it('матрица переходов нормирована', () => {
    const matrix = getTransitionMatrix([0, 1, 2, 2, 4, 3, 0])
    matrix.forEach((row) => {
      const sum = row.reduce((acc, item) => acc + item, 0)
      expect(sum).toBeCloseTo(1, 6)
    })
  })

  it('predictNext учитывает число шагов', () => {
    const matrix = getTransitionMatrix([0, 1, 1, 2, 3, 4, 4, 3])
    const one = predictNext(1, matrix, 1)
    const three = predictNext(1, matrix, 3)
    expect(one[1].probability).not.toBeCloseTo(three[1].probability, 6)
    expect(three.reduce((acc, item) => acc + item.probability, 0)).toBeCloseTo(1, 6)
  })
})
