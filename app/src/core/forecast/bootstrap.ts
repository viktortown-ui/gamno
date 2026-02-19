import type { EtsFitResult } from './ets'

export interface BootstrapResult {
  p10: number[]
  p50: number[]
  p90: number[]
  paths: number[][]
}

function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (1664525 * state + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  const position = (sorted.length - 1) * q
  const base = Math.floor(position)
  const rest = position - base
  if (sorted[base + 1] === undefined) return sorted[base]
  return sorted[base] + rest * (sorted[base + 1] - sorted[base])
}

export function bootstrapIntervals(
  fit: EtsFitResult,
  horizon: number,
  simulations = 2000,
  seed = 42,
): BootstrapResult {
  const residuals = fit.residuals.length ? fit.residuals : [0]
  const rand = seeded(seed)
  const paths: number[][] = []

  for (let i = 0; i < simulations; i += 1) {
    let level = fit.level
    let trend = fit.trend
    const path: number[] = []

    for (let step = 0; step < horizon; step += 1) {
      const residual = residuals[Math.floor(rand() * residuals.length)]
      const baseForecast = level + trend
      const withNoise = baseForecast + residual
      path.push(Number(withNoise.toFixed(3)))

      if (fit.modelType === 'ses') {
        level = fit.alpha * withNoise + (1 - fit.alpha) * level
      } else {
        const nextLevel = fit.alpha * withNoise + (1 - fit.alpha) * (level + trend)
        const beta = fit.beta ?? 0
        trend = beta * (nextLevel - level) + (1 - beta) * trend
        level = nextLevel
      }
    }

    paths.push(path)
  }

  const p10: number[] = []
  const p50: number[] = []
  const p90: number[] = []

  for (let step = 0; step < horizon; step += 1) {
    const bucket = paths.map((path) => path[step])
    p10.push(Number(quantile(bucket, 0.1).toFixed(3)))
    p50.push(Number(quantile(bucket, 0.5).toFixed(3)))
    p90.push(Number(quantile(bucket, 0.9).toFixed(3)))
  }

  return { p10, p50, p90, paths }
}
