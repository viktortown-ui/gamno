import { exportDB, importDB } from 'dexie-export-import'
import type { CheckinRecord, CheckinValues } from '../models/checkin'
import { METRICS, type MetricId } from '../metrics'
import { db } from './db'
import type { QuestRecord } from '../models/quest'
import { defaultInfluenceMatrix } from '../engines/influence/influence'
import type { InfluenceMatrix, OracleScenario } from '../engines/influence/types'
import { completeQuest } from '../engines/engagement/quests'
import { computeCoreState, type CoreStateSnapshot } from '../engines/stateEngine'
import type { StateSnapshotRecord } from '../models/state'

export async function addCheckin(values: CheckinValues): Promise<CheckinRecord> {
  const ts = Date.now()
  const id = await db.checkins.add({ ...values, ts })
  const saved = { ...values, ts, id }
  await saveStateSnapshot(ts)
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
}

function clamp(id: MetricId, value: number): number {
  const metric = METRICS.find((item) => item.id === id)
  if (!metric) return value
  return Math.max(metric.min, Math.min(metric.max, Number(value.toFixed(metric.step < 1 ? 1 : 0))))
}

export interface InfluenceLearnedMeta {
  windowDays: number
  computedAt: number
}

function emptyInfluenceMatrix(): InfluenceMatrix {
  return METRICS.reduce<Partial<InfluenceMatrix>>((acc, metric) => {
    acc[metric.id] = {}
    return acc
  }, {}) as InfluenceMatrix
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

export async function loadInfluenceLearnedMap(): Promise<InfluenceMatrix> {
  const row = await db.settings.get('influence-learned-map')
  return (row?.value as InfluenceMatrix | undefined) ?? emptyInfluenceMatrix()
}

export async function saveInfluenceLearnedMap(value: InfluenceMatrix): Promise<void> {
  await db.settings.put({ key: 'influence-learned-map', value, updatedAt: Date.now() })
}

export async function loadInfluenceLearnedMeta(): Promise<InfluenceLearnedMeta | null> {
  const row = await db.settings.get('influence-learned-meta')
  return (row?.value as InfluenceLearnedMeta | undefined) ?? null
}

export async function saveInfluenceLearnedMeta(value: InfluenceLearnedMeta): Promise<void> {
  await db.settings.put({ key: 'influence-learned-meta', value, updatedAt: Date.now() })
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
