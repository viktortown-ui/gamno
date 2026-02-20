import { db } from '../core/storage/db'
import { dayKeyFromTs } from '../core/utils/dayKey'
import type { SocialEventRecord } from '../core/models/socialRadar'

interface AddEventInput {
  ts: number
  type: string
  intensity: number
  valence: number
  durationMin?: number
  personId?: number
  tags?: string[]
  note?: string
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export async function addEvent(input: AddEventInput): Promise<SocialEventRecord> {
  const now = Date.now()
  const record: SocialEventRecord = {
    ts: input.ts,
    dayKey: dayKeyFromTs(input.ts),
    type: input.type.trim(),
    intensity: clamp(Math.round(input.intensity), 0, 5),
    valence: clamp(Math.round(input.valence), -2, 2),
    durationMin: input.durationMin,
    personId: input.personId,
    tags: input.tags?.map((tag) => tag.trim()).filter(Boolean),
    note: input.note?.trim() || undefined,
    createdAt: now,
  }
  const id = await db.events.add(record)
  return { ...record, id }
}

export async function deleteEvent(id: number): Promise<void> {
  await db.events.delete(id)
}

export async function listByRange(dayFrom: string, dayTo: string): Promise<SocialEventRecord[]> {
  return db.events
    .where('dayKey')
    .between(dayFrom, dayTo, true, true)
    .sortBy('ts')
}

export async function listRecent(limit = 100): Promise<SocialEventRecord[]> {
  return db.events.orderBy('ts').reverse().limit(limit).toArray()
}
