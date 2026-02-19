import type { CheckinRecord } from '../models/checkin'
import type { StateSnapshotRecord } from '../models/state'
import { bootstrapIntervals } from './bootstrap'
import { runRollingBacktest, type BacktestSummary } from './backtest'
import { buildDailySeries, type ForecastSeriesKey } from './buildSeries'
import { fitBestEts, forecastFromFit, type EtsModelType } from './ets'

export interface ForecastRunConfig {
  horizon: 3 | 7 | 14
  simulations: 500 | 2000 | 5000
  backtestWindow: 30 | 60 | 'all'
  seed: number
}

export interface ForecastSeriesOutcome {
  key: ForecastSeriesKey
  dates: string[]
  point: number[]
  p10: number[]
  p50: number[]
  p90: number[]
  modelType: EtsModelType
  residualStd: number
  backtest: BacktestSummary
}

export interface ForecastRunResult {
  trainedOnDays: number
  config: ForecastRunConfig
  generatedAt: number
  index: ForecastSeriesOutcome
}

function std(values: number[]): number {
  if (!values.length) return 0
  const mean = values.reduce((s, v) => s + v, 0) / values.length
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

export function runForecastEngine(
  snapshots: StateSnapshotRecord[],
  checkins: CheckinRecord[],
  config: ForecastRunConfig,
): ForecastRunResult {
  const series = buildDailySeries(snapshots, checkins, 'index')
  const fit = fitBestEts(series.values)
  const point = forecastFromFit(fit, config.horizon)
  const intervals = bootstrapIntervals(fit, config.horizon, config.simulations, config.seed)
  const window = config.backtestWindow === 'all' ? series.values.length : config.backtestWindow
  const backtest = runRollingBacktest(series.dates, series.values, window, Math.min(config.simulations, 1000), config.seed)

  return {
    trainedOnDays: series.values.length,
    config,
    generatedAt: Date.now(),
    index: {
      key: 'index',
      dates: series.dates,
      point,
      p10: intervals.p10,
      p50: intervals.p50,
      p90: intervals.p90,
      modelType: fit.modelType,
      residualStd: Number(std(fit.residuals).toFixed(3)),
      backtest,
    },
  }
}
