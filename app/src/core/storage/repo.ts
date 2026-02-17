import type { CheckinRecord, CheckinValues } from '../models/checkin'
import { db } from './db'

export interface ExportPayload {
  checkins: CheckinRecord[]
}

const toNumber = (value: unknown, fallback = 0): number => {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

const normalizeCheckin = (value: Partial<CheckinRecord>): CheckinRecord => ({
  ...(typeof value.id === 'number' ? { id: value.id } : {}),
  ts: toNumber(value.ts, Date.now()),
  energy: toNumber(value.energy),
  focus: toNumber(value.focus),
  mood: toNumber(value.mood),
  stress: toNumber(value.stress),
  sleepHours: toNumber(value.sleepHours),
  social: toNumber(value.social),
  productivity: toNumber(value.productivity),
  health: toNumber(value.health),
  cashFlow: toNumber(value.cashFlow),
})

export async function addCheckin(values: CheckinValues): Promise<CheckinRecord> {
  const ts = Date.now()
  const id = await db.checkins.add({ ...values, ts })
  return { ...values, ts, id }
}

export async function getLatestCheckin(): Promise<CheckinRecord | undefined> {
  return db.checkins.orderBy('ts').last()
}

export async function listCheckins(days?: number): Promise<CheckinRecord[]> {
  const records = await db.checkins.orderBy('ts').toArray()
  const filtered =
    typeof days === 'number'
      ? records.filter((item) => item.ts >= Date.now() - days * 24 * 60 * 60 * 1000)
      : records

  return filtered.reverse()
}

export async function clearAllData(): Promise<void> {
  await db.transaction('rw', db.checkins, db.events, async () => {
    await db.checkins.clear()
    await db.events.clear()
  })
}

export async function exportData(): Promise<ExportPayload> {
  const checkins = await db.checkins.orderBy('ts').toArray()
  return { checkins }
}

export async function importData(payload: ExportPayload): Promise<void> {
  const checkins = Array.isArray(payload.checkins)
    ? payload.checkins.map((item) => normalizeCheckin(item))
    : []

  await db.transaction('rw', db.checkins, db.events, async () => {
    await db.checkins.clear()
    await db.events.clear()

    if (checkins.length > 0) {
      await db.checkins.bulkAdd(checkins)
    }
  })
}
