import { bootstrapIntervals } from './bootstrap'
import { fitBestEts, forecastFromFit } from './ets'

export interface BacktestRow {
  date: string
  actual: number
  p10: number
  p50: number
  p90: number
  insideBand: boolean
  absError: number
  squaredError: number
}

export interface BacktestSummary {
  mae: number
  rmse: number
  coverage: number
  averageIntervalWidth: number
  rows: BacktestRow[]
}

export function runRollingBacktest(
  dates: string[],
  values: number[],
  window: number,
  simulations = 500,
  seed = 42,
): BacktestSummary {
  if (values.length < 5) {
    return { mae: 0, rmse: 0, coverage: 0, averageIntervalWidth: 0, rows: [] }
  }

  const end = values.length
  const start = Math.max(3, end - window)
  const rows: BacktestRow[] = []

  for (let t = start; t < end; t += 1) {
    const train = values.slice(0, t)
    const fit = fitBestEts(train)
    const point = forecastFromFit(fit, 1)[0]
    const intervals = bootstrapIntervals(fit, 1, simulations, seed + t)
    const actual = values[t]
    const p10 = intervals.p10[0]
    const p90 = intervals.p90[0]
    const insideBand = actual >= p10 && actual <= p90
    const absError = Math.abs(actual - point)

    rows.push({
      date: dates[t] ?? `t${t}`,
      actual,
      p10,
      p50: intervals.p50[0],
      p90,
      insideBand,
      absError,
      squaredError: absError * absError,
    })
  }

  const mae = rows.reduce((sum, row) => sum + row.absError, 0) / rows.length
  const rmse = Math.sqrt(rows.reduce((sum, row) => sum + row.squaredError, 0) / rows.length)
  const coverage = rows.filter((row) => row.insideBand).length / rows.length
  const averageIntervalWidth = rows.reduce((sum, row) => sum + (row.p90 - row.p10), 0) / rows.length

  return {
    mae: Number(mae.toFixed(3)),
    rmse: Number(rmse.toFixed(3)),
    coverage: Number((coverage * 100).toFixed(2)),
    averageIntervalWidth: Number(averageIntervalWidth.toFixed(3)),
    rows,
  }
}
