import { db } from '../core/storage/db'
import type { AntifragilityRules, AntifragilitySnapshotRecord, ShockSessionRecord } from '../core/models/antifragility'
import { computeAntifragility, defaultAntifragilityRules, type AntifragilityDayInput } from '../core/engines/antifragility'
import { dayKeyFromTs } from '../core/utils/dayKey'
import { getLastBlackSwanRun } from './blackSwanRepo'

const SETTINGS_KEY = 'antifragility-rules'

export async function getSettings(): Promise<AntifragilityRules> {
  const row = await db.antifragilityRules.get(SETTINGS_KEY)
  return row?.value ?? defaultAntifragilityRules
}

export async function saveSettings(value: AntifragilityRules): Promise<void> {
  await db.antifragilityRules.put({ key: SETTINGS_KEY, value, updatedAt: Date.now() })
}

export async function listShockSessions(limit = 100): Promise<ShockSessionRecord[]> {
  return db.shockSessions.orderBy('ts').reverse().limit(limit).toArray()
}

export async function createShockSession(session: Omit<ShockSessionRecord, 'id' | 'ts' | 'dayKey'> & { ts?: number; dayKey?: string }): Promise<ShockSessionRecord> {
  const ts = session.ts ?? Date.now()
  const record: ShockSessionRecord = { ...session, ts, dayKey: session.dayKey ?? dayKeyFromTs(ts) }
  const id = await db.shockSessions.add(record)
  return { ...record, id }
}

export async function computeAndSaveSnapshot(params: { afterCheckinId?: number; afterQuestId?: number }): Promise<AntifragilitySnapshotRecord> {
  const [stateSnapshots, regimeSnapshots, debtSnapshots, rules, sessions, blackSwan] = await Promise.all([
    db.stateSnapshots.orderBy('ts').toArray(),
    db.regimeSnapshots.orderBy('ts').toArray(),
    db.timeDebtSnapshots.orderBy('ts').toArray(),
    getSettings(),
    listShockSessions(300),
    getLastBlackSwanRun(),
  ])

  const regimeByDay = new Map(regimeSnapshots.map((item) => [item.dayKey, item]))
  const debtByDay = new Map(debtSnapshots.map((item) => [item.dayKey, item]))
  const dayRows: AntifragilityDayInput[] = stateSnapshots.map((state) => {
    const dayKey = dayKeyFromTs(state.ts)
    const regime = regimeByDay.get(dayKey)
    const debt = debtByDay.get(dayKey)
    return {
      dayKey,
      index: state.index,
      pCollapse: regime?.pCollapse ?? 0,
      sirenLevel: regime?.sirenLevel ?? 'green',
      volatility: state.volatility,
      entropy: state.entropy,
      drift: state.drift,
      timeDebtTotal: debt?.totals.totalDebt ?? 0,
      regimeId: regime?.regimeId ?? 0,
    }
  })

  const computed = computeAntifragility({
    series: dayRows,
    sessions,
    tailRisk: blackSwan?.summary.esCollapse10 ?? 0,
    rules,
  })

  const lastRegime = regimeSnapshots.at(-1)
  const snapshot: AntifragilitySnapshotRecord = {
    ts: Date.now(),
    dayKey: dayKeyFromTs(Date.now()),
    recoveryScore: computed.recoveryScore,
    shockBudget: computed.shockBudget,
    antifragilityScore: computed.antifragilityScore,
    explainTop3: computed.explainTop3,
    links: { checkinId: params.afterCheckinId, questId: params.afterQuestId, regimeSnapshotId: lastRegime?.id },
  }

  const id = await db.antifragilitySnapshots.add(snapshot)
  return { ...snapshot, id }
}

export async function getLastSnapshot(): Promise<AntifragilitySnapshotRecord | undefined> {
  return db.antifragilitySnapshots.orderBy('ts').last()
}

export async function listSnapshots(limit = 30): Promise<AntifragilitySnapshotRecord[]> {
  return db.antifragilitySnapshots.orderBy('ts').reverse().limit(limit).toArray()
}
