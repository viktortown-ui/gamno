import { computeAndSaveFrame } from './frameRepo'
import { db } from '../core/storage/db'
import type { MetricId } from '../core/metrics'
import type { MultiverseConfig, MultiverseRunResult } from '../core/engines/multiverse/types'

export interface MultiverseScenarioRecord {
  id?: number
  nameRu: string
  baselineTs?: number
  impulses: Partial<Record<MetricId, number>>
  createdAt: number
  updatedAt: number
}

export interface MultiverseSettingsRecord {
  key: 'default'
  value: {
    horizonDays: 7 | 14 | 30
    sims: 1000 | 5000 | 10000 | 25000
    seed: number
    weightsSource: 'manual' | 'learned' | 'mixed'
    mix: number
    useShockProfile: boolean
  }
  updatedAt: number
}

export interface MultiverseRunRecord {
  id?: number
  ts: number
  config: MultiverseConfig
  summary: MultiverseRunResult['tail']
  quantiles: MultiverseRunResult['quantiles']
  samplePaths: MultiverseRunResult['samplePaths']
  audit: MultiverseRunResult['audit']
  branches?: MultiverseRunResult['branches']
}

export async function saveScenario(scenario: Omit<MultiverseScenarioRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<MultiverseScenarioRecord> {
  const now = Date.now()
  const record: MultiverseScenarioRecord = { ...scenario, createdAt: now, updatedAt: now }
  const id = await db.multiverseScenarios.add(record)
  return { ...record, id }
}

export async function listScenarios(limit = 50): Promise<MultiverseScenarioRecord[]> {
  return db.multiverseScenarios.orderBy('updatedAt').reverse().limit(limit).toArray()
}

export async function deleteScenario(id: number): Promise<void> {
  await db.multiverseScenarios.delete(id)
}

export async function saveRun(run: MultiverseRunRecord): Promise<MultiverseRunRecord> {
  const id = await db.multiverseRuns.add(run)
  const saved = { ...run, id }
  await computeAndSaveFrame({ afterRunId: id })
  return saved
}

export async function listRuns(limit = 20): Promise<MultiverseRunRecord[]> {
  return db.multiverseRuns.orderBy('ts').reverse().limit(limit).toArray()
}

export async function getLastRun(): Promise<MultiverseRunRecord | undefined> {
  return db.multiverseRuns.orderBy('ts').last()
}

export async function saveSettings(value: MultiverseSettingsRecord['value']): Promise<MultiverseSettingsRecord> {
  const record: MultiverseSettingsRecord = { key: 'default', value, updatedAt: Date.now() }
  await db.multiverseSettings.put(record)
  return record
}

export async function getSettings(): Promise<MultiverseSettingsRecord | undefined> {
  return db.multiverseSettings.get('default')
}

// backward compatibility
export const saveMultiverseRun = saveRun
export const listMultiverseRuns = listRuns
export const getLastMultiverseRun = getLastRun

export async function clearMultiverseRuns(): Promise<void> {
  await db.multiverseRuns.clear()
}
