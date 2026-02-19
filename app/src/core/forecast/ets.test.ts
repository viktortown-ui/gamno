import { describe, expect, it } from 'vitest'
import { fitBestEts, forecastFromFit } from './ets'

describe('ETS', () => {
  it('детерминированно выбирает модель и прогноз', () => {
    const series = [40, 42, 43, 46, 48, 49, 50]
    const fit = fitBestEts(series)
    const forecast = forecastFromFit(fit, 3)

    expect(['ses', 'holt']).toContain(fit.modelType)
    expect(forecast).toEqual(forecastFromFit(fitBestEts(series), 3))
    expect(fit.mse).toBeGreaterThanOrEqual(0)
  })
})
