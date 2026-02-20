import { buildFrameDiffTop3, buildFrameSnapshot, type FrameSnapshot } from '../core/frame/frameEngine'
import { db } from '../core/storage/db'
import { getActiveGoal, getActiveQuest, getLatestRegimeSnapshot, getLatestStateSnapshot, listGoalEvents } from '../core/storage/repo'
import { computeSocialRadar } from '../core/engines/socialRadar'
import { listRecent } from './eventsRepo'
import { listPeople } from './peopleRepo'
import { getLastSnapshot as getLastTimeDebtSnapshot } from './timeDebtRepo'
import { getLastSnapshot as getLastAntifragilitySnapshot } from './antifragilityRepo'
import { getLastBlackSwanRun } from './blackSwanRepo'
import { getLatestForecastRun } from './forecastRepo'
import { getLastRun as getLastMultiverseRun } from './multiverseRepo'
import { getActivePolicy, getLastRun as getLastPolicyRun } from './policyRepo'

export interface FrameSnapshotRecord {
  id?: number
  ts: number
  dayKey: string
  sourceRefs: Record<string, number | string | undefined>
  payload: FrameSnapshot
  diffTop3: string[]
}

export async function computeAndSaveFrame(source: { afterCheckinId?: number; afterQuestId?: number; afterRunId?: number } = {}): Promise<FrameSnapshotRecord> {
  const [state, regime, goal, quest, debt, antifragility, forecast, blackSwan, multiverse, activePolicy, lastPolicyRun, people, events, previousFrame] = await Promise.all([
    getLatestStateSnapshot(),
    getLatestRegimeSnapshot(),
    getActiveGoal(),
    getActiveQuest(),
    getLastTimeDebtSnapshot(),
    getLastAntifragilitySnapshot(),
    getLatestForecastRun(),
    getLastBlackSwanRun(),
    getLastMultiverseRun(),
    getActivePolicy(),
    getLastPolicyRun(),
    listPeople(),
    listRecent(500),
    getLastFrame(),
  ])

  const radar = computeSocialRadar(await db.checkins.orderBy('ts').toArray(), events, people, { windowDays: 56, maxLag: 7 })
  const socialTop3 = Object.entries(radar.influencesByMetric)
    .flatMap(([, items]) => items.slice(0, 1).map((item) => `${item.key} через ${item.lag} дн.`))
    .slice(0, 3)

  const goalEvents = goal?.id ? await listGoalEvents(goal.id, 3) : []

  const payload = buildFrameSnapshot({
    baselineId: source.afterCheckinId,
    state,
    regime,
    goal,
    goalScore: goalEvents[0]?.goalScore,
    goalGap: goalEvents[0]?.goalGap,
    goalExplainTop3: goalEvents.length ? [`Измерений цели: ${goalEvents.length}`] : [],
    activeQuest: quest,
    debt,
    antifragility,
    forecast,
    blackSwan,
    multiverse,
    socialTop3,
    activePolicy,
    lastPolicyRun,
  })

  const diffTop3 = buildFrameDiffTop3(payload, previousFrame?.payload)
  const record: FrameSnapshotRecord = {
    ts: payload.ts,
    dayKey: payload.dayKey,
    sourceRefs: {
      stateId: state?.id,
      regimeId: regime?.id,
      goalId: goal?.id,
      questId: quest?.id,
      debtId: debt?.id,
      antifragilityId: antifragility?.id,
      forecastId: forecast?.id,
      blackSwanId: blackSwan?.id,
      multiverseId: multiverse?.id,
      afterCheckinId: source.afterCheckinId,
      afterQuestId: source.afterQuestId,
      afterRunId: source.afterRunId,
    },
    payload,
    diffTop3,
  }

  const id = await db.frameSnapshots.add(record)
  return { ...record, id }
}

export async function getLastFrame(): Promise<FrameSnapshotRecord | undefined> {
  return db.frameSnapshots.orderBy('ts').last()
}

export async function listFrames(range?: { fromTs?: number; toTs?: number; limit?: number }): Promise<FrameSnapshotRecord[]> {
  const rows = await db.frameSnapshots.orderBy('ts').reverse().toArray()
  return rows
    .filter((item) => (range?.fromTs ? item.ts >= range.fromTs : true) && (range?.toTs ? item.ts <= range.toTs : true))
    .slice(0, range?.limit ?? rows.length)
}
