import { Dexie, type EntityTable } from 'dexie'
import type { CheckinRecord } from '../models/checkin'
import type { AppEventRecord } from '../models/event'
import type { InfluenceMatrix, OracleScenario } from '../engines/influence/types'

export interface AppSettingRecord {
  key: string
  value: InfluenceMatrix
  updatedAt: number
}

export interface OracleScenarioRecord extends OracleScenario {
  id?: number
}

export const schemaVersion = 2

class GamnoDb extends Dexie {
  checkins!: EntityTable<CheckinRecord, 'id'>
  events!: EntityTable<AppEventRecord, 'id'>
  settings!: EntityTable<AppSettingRecord, 'key'>
  scenarios!: EntityTable<OracleScenarioRecord, 'id'>

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
    })
  }
}

export const db = new GamnoDb()
