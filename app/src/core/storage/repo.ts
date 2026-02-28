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
import type { GoalEventRecord, GoalRecord } from '../models/goal'
import { computeAndSaveSnapshot as computeAndSaveTimeDebtSnapshot } from '../../repo/timeDebtRepo'
import { computeAndSaveSnapshot as computeAndSaveAntifragilitySnapshot } from '../../repo/antifragilityRepo'
import { computeAndSaveFrame } from '../../repo/frameRepo'

export async function addCheckin(values: CheckinValues): Promise<CheckinRecord> {
  const ts = Date.now()
  const id = await db.checkins.add({ ...values, ts })
  const saved = { ...values, ts, id }
  await saveStateSnapshot(ts)
  await saveRegimeSnapshot(ts)
  await computeAndSaveTimeDebtSnapshot({ afterCheckinId: id })
  await computeAndSaveAntifragilitySnapshot({ afterCheckinId: id })
  await computeAndSaveFrame({ afterCheckinId: id })
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
  await computeAndSaveFrame()
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

  await computeAndSaveFrame()
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
  await computeAndSaveTimeDebtSnapshot({ afterQuestId: id })
  await computeAndSaveAntifragilitySnapshot({ afterQuestId: id })
  await computeAndSaveFrame({ afterQuestId: id })
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


function createGoalId(): string {
  return `goal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function normalizeGoalRecord(row: unknown): GoalRecord | null {
  if (!row || typeof row !== 'object') return null
  const source = row as Partial<GoalRecord> & { id?: string | number; status?: string; active?: boolean; weights?: Record<string, number>; okr?: GoalRecord['okr'] }
  const now = Date.now()
  const id = source.id == null ? createGoalId() : String(source.id)
  const title = (source.title ?? '').trim()
  if (!title) return null
  const status: GoalRecord['status'] = source.status === 'archived' ? 'archived' : source.status === 'active' ? 'active' : 'draft'
  const horizonDays = source.horizonDays === 7 || source.horizonDays === 30 ? source.horizonDays : 14
  const okr = source.okr && typeof source.okr.objective === 'string' && Array.isArray(source.okr.keyResults)
    ? {
      objective: source.okr.objective,
      keyResults: source.okr.keyResults.map((item) => ({
        id: String(item.id ?? `kr-${Math.random().toString(36).slice(2, 8)}`),
        metricId: item.metricId,
        direction: item.direction === 'down' ? 'down' as const : 'up' as const,
        target: item.target,
        progress: typeof item.progress === 'number' ? Math.max(0, Math.min(1, item.progress)) : undefined,
        progressMode: item.progressMode === 'manual' ? 'manual' as const : 'auto' as const,
        note: item.note,
      })),
    }
    : { objective: '', keyResults: [] }

  const legacyMission = source.activeMission as {
    id?: string
    title?: string
    createdAt?: number
    horizonDays?: number
    actions?: Array<{ krId?: string }>
  } | undefined

  const activeMission = source.activeMission && typeof source.activeMission === 'object'
    ? {
      id: String(source.activeMission.id ?? `mission-${id}`),
      goalId: String((source.activeMission as { goalId?: string }).goalId ?? id),
      krKey: String((source.activeMission as { krKey?: string }).krKey ?? legacyMission?.actions?.[0]?.krId ?? okr.keyResults[0]?.id ?? 'kr-unknown'),
      templateId: (source.activeMission as { templateId?: string }).templateId,
      title: String((source.activeMission as { title?: string }).title ?? 'Миссия'),
      why: (source.activeMission as { why?: string }).why,
      timeBandMinutes: ((source.activeMission as { timeBandMinutes?: number }).timeBandMinutes === 5 || (source.activeMission as { timeBandMinutes?: number }).timeBandMinutes === 30 ? (source.activeMission as { timeBandMinutes?: number }).timeBandMinutes : 15) as 5 | 15 | 30,
      effectProfile: ((source.activeMission as { effectProfile?: string }).effectProfile === 'small' || (source.activeMission as { effectProfile?: string }).effectProfile === 'large'
        ? (source.activeMission as { effectProfile?: 'small' | 'large' }).effectProfile
        : 'medium') as 'small' | 'medium' | 'large',
      ifThenPlan: (source.activeMission as { ifThenPlan?: string }).ifThenPlan,
      durationDays: ((source.activeMission as { durationDays?: number }).durationDays === 1 ? 1 : 3) as 1 | 3,
      startedAt: Number((source.activeMission as { startedAt?: number }).startedAt ?? legacyMission?.createdAt ?? now),
      endsAt: Number((source.activeMission as { endsAt?: number }).endsAt ?? ((legacyMission?.createdAt ?? now) + ((legacyMission?.horizonDays === 1 ? 1 : 3) * 24 * 60 * 60 * 1000))),
      expectedMin: Math.round(Number((source.activeMission as { expectedMin?: number }).expectedMin ?? (legacyMission?.horizonDays === 1 ? 1 : 3))),
      expectedMax: Math.round(Number((source.activeMission as { expectedMax?: number }).expectedMax ?? (legacyMission?.horizonDays === 1 ? 4 : 8))),
      expectedDefault: Math.round(Number((source.activeMission as { expectedDefault?: number }).expectedDefault ?? (legacyMission?.horizonDays === 1 ? 2 : 5))),
    }
    : undefined

  const missionHistory = Array.isArray(source.missionHistory)
    ? source.missionHistory
      .map((item) => {
        if (!item || typeof item !== 'object') return null
        const rowItem = item as unknown as Record<string, unknown>
        return {
          id: String(rowItem.id ?? `mission-history-${Math.random().toString(36).slice(2, 8)}`),
          goalId: String(rowItem.goalId ?? id),
          krKey: String(rowItem.krKey ?? okr.keyResults[0]?.id ?? 'kr-unknown'),
          templateId: typeof rowItem.templateId === 'string' ? rowItem.templateId : undefined,
          title: String(rowItem.title ?? 'Миссия'),
          durationDays: (Number(rowItem.durationDays) === 1 ? 1 : 3) as 1 | 3,
          completedAt: Number(rowItem.completedAt ?? now),
          coresAwarded: Math.round(Number(rowItem.coresAwarded ?? 0)),
        }
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .slice(0, 10)
    : []

  const missionControl = source.missionControl && typeof source.missionControl === 'object'
    ? {
      rerollDayKey: typeof source.missionControl.rerollDayKey === 'string' ? source.missionControl.rerollDayKey : undefined,
      rerollsUsed: Number.isFinite(source.missionControl.rerollsUsed) ? Math.max(0, Math.min(2, Number(source.missionControl.rerollsUsed))) : 0,
      lastRerollAt: Number.isFinite(source.missionControl.lastRerollAt) ? Number(source.missionControl.lastRerollAt) : undefined,
      lastSuggestions: Array.isArray(source.missionControl.lastSuggestions)
        ? source.missionControl.lastSuggestions
          .map((item) => {
            if (!item || typeof item !== 'object') return null
            const rowItem = item as Record<string, unknown>
            if (typeof rowItem.krKey !== 'string' || typeof rowItem.templateId !== 'string') return null
            return {
              krKey: rowItem.krKey,
              templateId: rowItem.templateId,
              ts: Number.isFinite(rowItem.ts) ? Number(rowItem.ts) : now,
            }
          })
          .filter((item): item is NonNullable<typeof item> => Boolean(item))
          .slice(0, 20)
        : [],
    }
    : { rerollsUsed: 0, lastSuggestions: [] }

  return {
    id,
    createdAt: typeof source.createdAt === 'number' ? source.createdAt : now,
    updatedAt: typeof source.updatedAt === 'number' ? source.updatedAt : now,
    title,
    description: source.description,
    horizonDays,
    status,
    active: Boolean(source.active) || status === 'active',
    weights: source.weights ?? {},
    okr,
    activeMission,
    missionHistory,
    missionControl,
    modePresetId: source.modePresetId,
    isManualTuning: Boolean(source.isManualTuning),
    manualTuning: source.manualTuning ? {
      weights: source.manualTuning.weights ?? source.weights ?? {},
      krDirections: source.manualTuning.krDirections,
      horizonDays: source.manualTuning.horizonDays,
    } : undefined,
    template: source.template,
    targetIndex: source.targetIndex,
    targetPCollapse: source.targetPCollapse,
    constraints: source.constraints,
  }
}

async function ensureGoalsMigrated(): Promise<void> {
  const rows = await db.goals.toArray()
  const normalized = rows
    .map((row) => normalizeGoalRecord(row))
    .filter((row): row is GoalRecord => Boolean(row))

  if (!normalized.length) {
    await db.settings.delete('active-goal-id')
    return
  }

  let activeId = normalized.find((item) => item.active && item.status === 'active')?.id
  if (!activeId) {
    const fromSetting = await db.settings.get('active-goal-id')
    if (typeof fromSetting?.value === 'string' || typeof fromSetting?.value === 'number') {
      const candidateId = String(fromSetting.value)
      const candidate = normalized.find((item) => item.id === candidateId && item.status !== 'archived')
      if (candidate) {
        candidate.status = 'active'
        candidate.active = true
        activeId = candidate.id
      }
    }
  }

  if (!activeId) {
    const fallback = normalized.find((item) => item.status !== 'archived')
    if (fallback) {
      fallback.status = 'active'
      fallback.active = true
      activeId = fallback.id
    }
  }

  const now = Date.now()
  const enforced: GoalRecord[] = normalized.map((item) => {
    const isActive = item.id === activeId && item.status === 'active'
    return {
      ...item,
      active: isActive,
      status: item.status === 'archived' ? 'archived' : (isActive ? 'active' : 'draft'),
      updatedAt: item.updatedAt || now,
    }
  })

  await db.transaction('rw', db.goals, db.settings, async () => {
    await db.goals.clear()
    await db.goals.bulkPut(enforced)
    if (activeId) {
      await db.settings.put({ key: 'active-goal-id', value: activeId, updatedAt: now })
    } else {
      await db.settings.delete('active-goal-id')
    }
  })
}

export interface CreateGoalInput {
  title: string
  description?: string
  horizonDays?: 7 | 14 | 30
  status?: GoalRecord['status']
  weights?: Record<string, number>
  okr?: GoalRecord['okr']
  template?: GoalRecord['template']
  targetIndex?: number
  targetPCollapse?: number
  constraints?: GoalRecord['constraints']
  modePresetId?: GoalRecord['modePresetId']
  isManualTuning?: boolean
  manualTuning?: GoalRecord['manualTuning']
}

export async function createGoal(goal: CreateGoalInput): Promise<GoalRecord> {
  await ensureGoalsMigrated()
  const now = Date.now()
  const id = createGoalId()
  const hasActive = await getActiveGoal()
  const record: GoalRecord = {
    id,
    title: goal.title,
    description: goal.description,
    horizonDays: goal.horizonDays ?? 14,
    status: goal.status ?? 'draft',
    active: false,
    weights: goal.weights ?? {},
    okr: goal.okr ?? { objective: '', keyResults: [] },
    template: goal.template,
    targetIndex: goal.targetIndex,
    targetPCollapse: goal.targetPCollapse,
    constraints: goal.constraints,
    modePresetId: goal.modePresetId,
    isManualTuning: Boolean(goal.isManualTuning),
    manualTuning: goal.manualTuning,
    createdAt: now,
    updatedAt: now,
  }
  const normalized = normalizeGoalRecord(record)
  if (!normalized) {
    throw new Error('Invalid goal payload')
  }
  await db.goals.put(normalized)
  if (!hasActive && normalized.status !== 'archived') {
    return (await setActiveGoal(normalized.id)) ?? normalized
  }
  return normalized
}

export async function updateGoal(id: string, patch: Partial<Omit<GoalRecord, 'id' | 'createdAt'>>): Promise<GoalRecord | undefined> {
  await ensureGoalsMigrated()
  const row = await db.goals.get(id)
  const normalized = normalizeGoalRecord(row)
  if (!normalized) return undefined
  const updated: GoalRecord = normalizeGoalRecord({ ...normalized, ...patch, id, updatedAt: Date.now() }) as GoalRecord
  await db.goals.put(updated)

  if (updated.status === 'archived' && updated.active) {
    const all = await listGoals()
    const next = all.find((item) => item.id !== id && item.status !== 'archived')
    if (next) {
      await setActiveGoal(next.id)
    } else {
      await db.settings.delete('active-goal-id')
    }
  }

  return updated
}

export async function listGoals(): Promise<GoalRecord[]> {
  await ensureGoalsMigrated()
  const rows = await db.goals.orderBy('updatedAt').reverse().toArray()
  return rows.map((item) => normalizeGoalRecord(item)).filter((item): item is GoalRecord => Boolean(item))
}

export async function getActiveGoal(): Promise<GoalRecord | undefined> {
  await ensureGoalsMigrated()
  const manual = await db.settings.get('active-goal-id')
  const activeId = typeof manual?.value === 'string' || typeof manual?.value === 'number' ? String(manual.value) : undefined
  if (activeId) {
    const byId = normalizeGoalRecord(await db.goals.get(activeId))
    if (byId?.active && byId.status === 'active') return byId
  }
  const all = await listGoals()
  return all.find((item) => item.active && item.status === 'active')
}

export async function setActiveGoal(id: string): Promise<GoalRecord | undefined> {
  await ensureGoalsMigrated()
  const all = await listGoals()
  const target = all.find((item) => item.id === id)
  if (!target || target.status === 'archived') return undefined
  const now = Date.now()

  await db.transaction('rw', db.goals, db.settings, async () => {
    await Promise.all(all.map(async (item) => {
      const next: GoalRecord = {
        ...item,
        active: item.id === id,
        status: item.id === id ? 'active' : (item.status === 'archived' ? 'archived' : 'draft'),
        updatedAt: now,
      }
      await db.goals.put(next)
    }))
    await db.settings.put({ key: 'active-goal-id', value: id, updatedAt: now })
  })

  return normalizeGoalRecord(await db.goals.get(id)) ?? undefined
}


export async function addGoalEvent(event: Omit<GoalEventRecord, 'id' | 'ts'> & { ts?: number }): Promise<GoalEventRecord> {
  const record: GoalEventRecord = { ...event, goalId: String(event.goalId), ts: event.ts ?? Date.now() }
  const id = await db.goalEvents.add(record)
  return { ...record, id }
}

export async function listGoalEvents(goalId: string, limit = 30): Promise<GoalEventRecord[]> {
  const rows = await db.goalEvents.toArray()
  return rows
    .filter((row) => String(row.goalId) === goalId)
    .sort((a, b) => b.ts - a.ts)
    .slice(0, limit)
}
