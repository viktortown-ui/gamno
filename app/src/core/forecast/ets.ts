export type EtsModelType = 'ses' | 'holt'

export interface EtsFitResult {
  modelType: EtsModelType
  alpha: number
  beta?: number
  fitted: number[]
  residuals: number[]
  mse: number
  level: number
  trend: number
}

const ALPHA_GRID = [0.2, 0.35, 0.5, 0.65, 0.8]
const BETA_GRID = [0.1, 0.25, 0.4, 0.55]

function mse(values: number[]): number {
  if (!values.length) return 0
  return values.reduce((acc, value) => acc + value * value, 0) / values.length
}

function fitSes(series: number[], alpha: number): EtsFitResult {
  if (series.length < 2) {
    return { modelType: 'ses', alpha, fitted: [], residuals: [], mse: 0, level: series[0] ?? 0, trend: 0 }
  }

  let level = series[0]
  const fitted: number[] = []
  const residuals: number[] = []

  for (let i = 1; i < series.length; i += 1) {
    const oneStep = level
    fitted.push(oneStep)
    const error = series[i] - oneStep
    residuals.push(error)
    level = alpha * series[i] + (1 - alpha) * level
  }

  return {
    modelType: 'ses',
    alpha,
    fitted,
    residuals,
    mse: mse(residuals),
    level,
    trend: 0,
  }
}

function fitHolt(series: number[], alpha: number, beta: number): EtsFitResult {
  if (series.length < 3) {
    return { modelType: 'holt', alpha, beta, fitted: [], residuals: [], mse: 0, level: series[0] ?? 0, trend: 0 }
  }

  let level = series[0]
  let trend = series[1] - series[0]
  const fitted: number[] = []
  const residuals: number[] = []

  for (let i = 1; i < series.length; i += 1) {
    const oneStep = level + trend
    fitted.push(oneStep)
    const error = series[i] - oneStep
    residuals.push(error)

    const nextLevel = alpha * series[i] + (1 - alpha) * (level + trend)
    trend = beta * (nextLevel - level) + (1 - beta) * trend
    level = nextLevel
  }

  return {
    modelType: 'holt',
    alpha,
    beta,
    fitted,
    residuals,
    mse: mse(residuals),
    level,
    trend,
  }
}

export function fitBestEts(series: number[]): EtsFitResult {
  const candidates: EtsFitResult[] = []
  for (const alpha of ALPHA_GRID) {
    candidates.push(fitSes(series, alpha))
    for (const beta of BETA_GRID) {
      candidates.push(fitHolt(series, alpha, beta))
    }
  }
  return candidates.reduce((best, current) => (current.mse < best.mse ? current : best), candidates[0])
}

export function forecastFromFit(fit: EtsFitResult, horizon: number): number[] {
  return Array.from({ length: horizon }, (_, idx) => {
    const step = idx + 1
    return Number((fit.level + fit.trend * step).toFixed(3))
  })
}
