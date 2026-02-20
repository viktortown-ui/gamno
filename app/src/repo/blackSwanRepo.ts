import { db } from '../core/storage/db'
import type { BlackSwanScenarioSpec, BlackSwanResult } from '../core/engines/blackSwan/types'
import type { WeightsSource } from '../core/engines/influence/types'

export interface BlackSwanScenarioRecord { id?: number; name: string; spec: BlackSwanScenarioSpec; createdAt: number; updatedAt: number }
export interface BlackSwanRunRecord {
  id?: number
  ts: number
  baseId?: number
  horizon: number
  sims: number
  seed: number
  weightsSource: WeightsSource
  mix: number
  scenarioId?: number
  scenarioInline?: BlackSwanScenarioSpec
  summary: BlackSwanResult['summary'] & { probEverRed: number; probThresholdEnd: number; esCoreIndex: number }
  payload: Pick<BlackSwanResult, 'days' | 'coreIndex' | 'pCollapse' | 'histogram' | 'tail' | 'topDrivers' | 'recommendations' | 'noteRu'>
}

export async function listBlackSwanScenarios(): Promise<BlackSwanScenarioRecord[]> { return db.blackSwanScenarios.orderBy('updatedAt').reverse().toArray() }
export async function createBlackSwanScenario(spec: BlackSwanScenarioSpec): Promise<BlackSwanScenarioRecord> {
  const now = Date.now()
  const row: BlackSwanScenarioRecord = { name: spec.nameRu, spec, createdAt: now, updatedAt: now }
  const id = await db.blackSwanScenarios.add(row)
  return { ...row, id }
}
export async function updateBlackSwanScenario(id: number, spec: BlackSwanScenarioSpec): Promise<BlackSwanScenarioRecord | undefined> {
  const existing = await db.blackSwanScenarios.get(id)
  if (!existing) return undefined
  const next: BlackSwanScenarioRecord = { ...existing, name: spec.nameRu, spec, updatedAt: Date.now(), id }
  await db.blackSwanScenarios.put(next)
  return next
}
export async function deleteBlackSwanScenario(id: number): Promise<void> { await db.blackSwanScenarios.delete(id) }

export async function saveBlackSwanRun(run: BlackSwanRunRecord): Promise<BlackSwanRunRecord> {
  const id = await db.blackSwanRuns.add(run)
  return { ...run, id }
}
export async function getLastBlackSwanRun(): Promise<BlackSwanRunRecord | undefined> { return db.blackSwanRuns.orderBy('ts').last() }
export async function listBlackSwanRuns(limit = 20): Promise<BlackSwanRunRecord[]> { return db.blackSwanRuns.orderBy('ts').reverse().limit(limit).toArray() }
export async function clearBlackSwanRuns(): Promise<void> { await db.blackSwanRuns.clear() }
