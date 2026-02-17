export interface ForecastResult {
  values: number[]
  confidence: 'low' | 'med' | 'high'
}

export function forecastIndex(series: number[], alpha = 0.4, horizon = 7): ForecastResult {
  if (series.length === 0) return { values: Array.from({ length: horizon }, () => 0), confidence: 'low' }

  let level = series[0]
  for (let i = 1; i < series.length; i += 1) {
    level = alpha * series[i] + (1 - alpha) * level
  }

  const values = Array.from({ length: horizon }, (_, i) => Number((level + i * 0.03).toFixed(2)))
  const confidence: 'low' | 'med' | 'high' = series.length >= 30 ? 'high' : series.length >= 14 ? 'med' : 'low'
  return { values, confidence }
}
