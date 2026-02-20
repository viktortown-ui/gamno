import { db } from '../core/storage/db'
import type { PersonRecord } from '../core/models/socialRadar'

export async function createPerson(input: { nameAlias: string; notes?: string }): Promise<PersonRecord> {
  const now = Date.now()
  const record: PersonRecord = {
    nameAlias: input.nameAlias.trim(),
    notes: input.notes?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  }
  const id = await db.people.add(record)
  return { ...record, id }
}

export async function updatePerson(id: number, patch: Partial<Pick<PersonRecord, 'nameAlias' | 'notes'>>): Promise<PersonRecord | undefined> {
  const current = await db.people.get(id)
  if (!current) return undefined
  const updated: PersonRecord = {
    ...current,
    ...patch,
    nameAlias: (patch.nameAlias ?? current.nameAlias).trim(),
    notes: patch.notes === undefined ? current.notes : (patch.notes.trim() || undefined),
    updatedAt: Date.now(),
    id,
  }
  await db.people.put(updated)
  return updated
}

export async function deletePerson(id: number): Promise<void> {
  await db.people.delete(id)
}

export async function listPeople(): Promise<PersonRecord[]> {
  return db.people.orderBy('updatedAt').reverse().toArray()
}
