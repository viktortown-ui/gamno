import { exportDB, importDB } from 'dexie-export-import'
import type { CheckinRecord, CheckinValues } from '../models/checkin'
import { METRICS, type MetricId } from '../metrics'
import { trainLearnedInfluenceMatrix, type LearnedMatrix } from '../engines/influence/learnedInfluenceEngine'
import { db } from './db'
import type { QuestRecord } from '../models/quest'
import { defaultInfluenceMatrix } from '../engines/influence/influence'
import { hashMetricSet, learnedMatrixKey } from './learnedMatrix'
import type { InfluenceMatrix, OracleScenario } from '../engines/influence/types'
import { completeQuest } from '../engines/engagement/quests'
import { computeCoreState, type CoreStateSnapshot } from '../engines/stateEngine'
import type { StateSnapshotRecord } from '../models/state'
import { computeRegimeLayer } from '../regime/snapshot'
import type { RegimeSnapshotRecord } from '../models/regime'

export async function addCheckin(values: CheckinValues): Promise<CheckinRecord> {
  const ts = Date.now()
  const id = await db.checkins.add({ ...values, ts })
  const saved = { ...values, ts, id }
  await saveStateSnapshot(ts)
  await saveRegimeSnapshot(ts)
  return saved
}

export async function deleteCheckin(id: number): Promise<void> {
  await db.checkins.delete(id)
}

export async function getLatestCheckin(): Promise<CheckinRecord | undefined> {
  return db.checkins.orderBy('ts').last()
}

export async function listCheckins(days?: number): Promise<CheckinRecord[]> {
  const records = await db.checkins.orderBy('ts').toArray()
  const filtered = typeof days === 'number'
    ? records.filter((item) => item.ts >= Date.now() - days * 24 * 60 * 60 * 1000)
    : records
  return filtered.reverse()
}

export async function clearAllData(): Promise<void> {
  await db.delete()
  await db.open()
}

export async function exportDataBlob(): Promise<Blob> {
  return exportDB(db)
}

export async function importDataBlob(file: Blob): Promise<void> {
  await db.delete()
  await importDB(file)
  await db.open()
}

function seeded(seed = 42): () => number {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

export async function seedTestData(days = 30, seed = 42): Promise<void> {
  const rand = seeded(seed)
  const now = Date.now()
  const rows: CheckinRecord[] = Array.from({ length: days }).map((_, index) => {
    const ts = now - (days - index) * 24 * 60 * 60 * 1000
    const trend = index / days
    const stressSpike = rand() > 0.9 ? 2 : 0
    const energy = 4 + trend * 3 + (rand() - 0.5) * 2 - stressSpike
    const stress = 6 - trend * 2 + (rand() - 0.5) * 2 + stressSpike
    return {
      ts,
      energy: clamp('energy', energy),
      focus: clamp('focus', 4 + trend * 3 + (rand() - 0.5) * 2),
      mood: clamp('mood', 4 + trend * 2 + (rand() - 0.5) * 2),
      stress: clamp('stress', stress),
      sleepHours: clamp('sleepHours', 6.5 + (rand() - 0.5) * 2),
      social: clamp('social', 5 + (rand() - 0.5) * 3),
      productivity: clamp('productivity', 4 + trend * 3 + (rand() - 0.5) * 2),
      health: clamp('health', 5 + trend * 2 + (rand() - 0.5) * 2),
      cashFlow: Math.round((rand() - 0.4) * 20000),
    }
  })

  await db.checkins.bulkAdd(rows)
  await saveStateSnapshot(Date.now())
  await saveRegimeSnapshot(Date.now())
}

function clamp(id: MetricId, value: number): number {
  const metric = METRICS.find((item) => item.id === id)
  if (!metric) return value
  return Math.max(metric.min, Math.min(metric.max, Number(value.toFixed(metric.step < 1 ? 1 : 0))))
}

export async function loadInfluenceMatrix(): Promise<InfluenceMatrix> {
  const row = await db.settings.get('influence-matrix')
  return (row?.value as InfluenceMatrix | undefined) ?? defaultInfluenceMatrix
}

export async function saveInfluenceMatrix(value: InfluenceMatrix): Promise<void> {
  await db.settings.put({ key: 'influence-matrix', value, updatedAt: Date.now() })
}

export async function resetInfluenceMatrix(): Promise<void> {
  await saveInfluenceMatrix(defaultInfluenceMatrix)
}

export interface RecomputeLearnedMatrixParams {
  trainedOnDays: 30 | 60 | 'all'
  lags: 1 | 2 | 3
}

function metricSetHashCurrent(): string {
  return hashMetricSet(METRICS.map((metric) => metric.id))
}

export async function getLearnedMatrix(): Promise<LearnedMatrix | null> {
  const metricSetHash = metricSetHashCurrent()
  const rows = await db.learnedMatrices.where('metricSetHash').equals(metricSetHash).sortBy('computedAt')
  return rows.at(-1)?.value ?? null
}

export async function recomputeLearnedMatrix(params: RecomputeLearnedMatrixParams): Promise<LearnedMatrix> {
  const checkinsDesc = await listCheckins(params.trainedOnDays === 'all' ? undefined : params.trainedOnDays)
  const checkinsAsc = [...checkinsDesc].reverse()
  const learned = trainLearnedInfluenceMatrix(checkinsAsc, METRICS, {
    trainedOnDays: params.trainedOnDays,
    lags: params.lags,
  })

  const metricSetHash = metricSetHashCurrent()
  const key = learnedMatrixKey(metricSetHash, learned.meta.trainedOnDays, learned.meta.lags)

  await db.learnedMatrices.put({
    key,
    metricSetHash,
    trainedOnDays: learned.meta.trainedOnDays,
    lags: learned.meta.lags,
    computedAt: learned.meta.computedAt,
    value: learned,
  })

  return learned
}

export async function clearLearnedMatrices(): Promise<void> {
  await db.learnedMatrices.clear()
}

export async function addQuest(quest: QuestRecord): Promise<QuestRecord> {
  const id = await db.quests.add(quest)
  return { ...quest, id }
}

export async function listQuests(): Promise<QuestRecord[]> {
  return db.quests.orderBy('createdAt').reverse().toArray()
}

export async function getActiveQuest(): Promise<QuestRecord | undefined> {
  return db.quests.where('status').equals('active').last()
}

export async function completeQuestById(id: number): Promise<QuestRecord | undefined> {
  const row = await db.quests.get(id)
  if (!row) return undefined
  const completed = completeQuest(row)
  await db.quests.put(completed)
  await saveStateSnapshot(Date.now())
  await saveRegimeSnapshot(Date.now())
  return completed
}

export async function addScenario(scenario: OracleScenario): Promise<void> {
  await db.scenarios.add(scenario)
}

export async function listScenarios(): Promise<OracleScenario[]> {
  const rows = await db.scenarios.orderBy('ts').reverse().toArray()
  return rows
}

function toStateRecord(snapshot: CoreStateSnapshot): StateSnapshotRecord {
  return {
    ts: snapshot.ts,
    index: snapshot.index,
    risk: snapshot.risk,
    volatility: snapshot.volatility,
    xp: snapshot.xp,
    level: snapshot.level,
    entropy: snapshot.entropy,
    drift: snapshot.drift,
    stats: snapshot.stats,
  }
}

export async function computeCurrentStateSnapshot(ts = Date.now()): Promise<CoreStateSnapshot> {
  const [checkins, quests] = await Promise.all([listCheckins(), listQuests()])
  return computeCoreState(checkins, quests, ts)
}

export async function saveStateSnapshot(ts = Date.now()): Promise<StateSnapshotRecord> {
  const snapshot = await computeCurrentStateSnapshot(ts)
  const record = toStateRecord(snapshot)
  const id = await db.stateSnapshots.add(record)
  return { ...record, id }
}

export async function getLatestStateSnapshot(): Promise<StateSnapshotRecord | undefined> {
  return db.stateSnapshots.orderBy('ts').last()
}

export async function listStateSnapshots(limit = 90): Promise<StateSnapshotRecord[]> {
  return db.stateSnapshots.orderBy('ts').reverse().limit(limit).toArray()
}

export async function computeCurrentRegimeSnapshot(ts = Date.now()): Promise<RegimeSnapshotRecord> {
  const [checkins, stateSnapshot, activeQuest] = await Promise.all([listCheckins(), computeCurrentStateSnapshot(ts), getActiveQuest()])
  return computeRegimeLayer(checkins, stateSnapshot, activeQuest, ts).snapshot
}

export async function saveRegimeSnapshot(ts = Date.now()): Promise<RegimeSnapshotRecord> {
  const [checkins, stateSnapshot, activeQuest] = await Promise.all([listCheckins(), computeCurrentStateSnapshot(ts), getActiveQuest()])
  const regimeSnapshot = computeRegimeLayer(checkins, stateSnapshot, activeQuest, ts).snapshot
  const id = await db.regimeSnapshots.add(regimeSnapshot)
  return { ...regimeSnapshot, id }
}

export async function getLatestRegimeSnapshot(): Promise<RegimeSnapshotRecord | undefined> {
  return db.regimeSnapshots.orderBy('ts').last()
}

export async function listRegimeSnapshots(limit = 90): Promise<RegimeSnapshotRecord[]> {
  return db.regimeSnapshots.orderBy('ts').reverse().limit(limit).toArray()
}
