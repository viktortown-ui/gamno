import { Dexie, type EntityTable } from 'dexie'
import type { CheckinRecord } from '../models/checkin'
import type { AppEventRecord } from '../models/event'
import type { InfluenceMatrix, OracleScenario } from '../engines/influence/types'
import type { QuestRecord } from '../models/quest'

export interface AppSettingRecord {
  key: string
  value: InfluenceMatrix
  updatedAt: number
}

export interface OracleScenarioRecord extends OracleScenario {
  id?: number
}

export const schemaVersion = 3

class GamnoDb extends Dexie {
  checkins!: EntityTable<CheckinRecord, 'id'>
  events!: EntityTable<AppEventRecord, 'id'>
  settings!: EntityTable<AppSettingRecord, 'key'>
  scenarios!: EntityTable<OracleScenarioRecord, 'id'>
  quests!: EntityTable<QuestRecord, 'id'>

  constructor() {
    super('gamno-db')
    this.version(1).stores({
      checkins: '++id,ts',
      events: '++id,ts,type',
    })

    this.version(schemaVersion).stores({
      checkins: '++id,ts',
      events: '++id,ts,type',
      settings: '&key,updatedAt',
      scenarios: '++id,ts,nameRu',
      quests: '++id,createdAt,status',
    })
  }
}

export const db = new GamnoDb()
