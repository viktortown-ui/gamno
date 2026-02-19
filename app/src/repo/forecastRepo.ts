import { db } from '../core/storage/db'
import type { ForecastRunConfig } from '../core/forecast'
import type { EtsModelType } from '../core/forecast/ets'
import type { BacktestSummary } from '../core/forecast/backtest'

export interface ForecastRunRecord {
  id?: number
  ts: number
  config: ForecastRunConfig
  trainedOnDays: number
  horizons: number[]
  modelType: EtsModelType
  residualStats: {
    std: number
    sample: number
  }
  backtest: BacktestSummary
  index: {
    point: number[]
    p10: number[]
    p50: number[]
    p90: number[]
  }
}

export async function saveForecastRun(run: ForecastRunRecord): Promise<ForecastRunRecord> {
  const id = await db.forecastRuns.add(run)
  return { ...run, id }
}

export async function getLatestForecastRun(): Promise<ForecastRunRecord | undefined> {
  return db.forecastRuns.orderBy('ts').last()
}

export async function listForecastRuns(limit = 20): Promise<ForecastRunRecord[]> {
  return db.forecastRuns.orderBy('ts').reverse().limit(limit).toArray()
}

export async function clearForecastRuns(): Promise<void> {
  await db.forecastRuns.clear()
}
