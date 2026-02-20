import { db } from '../core/storage/db'
import type { MultiverseConfig, MultiverseRunResult } from '../core/engines/multiverse/types'

export interface MultiverseRunRecord {
  id?: number
  ts: number
  config: MultiverseConfig
  summary: MultiverseRunResult['tail']
  quantiles: MultiverseRunResult['quantiles']
  samplePaths: MultiverseRunResult['samplePaths']
  audit: MultiverseRunResult['audit']
}

export async function saveMultiverseRun(run: MultiverseRunRecord): Promise<MultiverseRunRecord> {
  const id = await db.multiverseRuns.add(run)
  return { ...run, id }
}

export async function listMultiverseRuns(limit = 20): Promise<MultiverseRunRecord[]> {
  return db.multiverseRuns.orderBy('ts').reverse().limit(limit).toArray()
}

export async function getLastMultiverseRun(): Promise<MultiverseRunRecord | undefined> {
  return db.multiverseRuns.orderBy('ts').last()
}

export async function clearMultiverseRuns(): Promise<void> {
  await db.multiverseRuns.clear()
}
