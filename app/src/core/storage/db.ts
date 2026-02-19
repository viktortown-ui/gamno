import { Dexie, type EntityTable } from 'dexie'
import type { CheckinRecord } from '../models/checkin'
import type { AppEventRecord } from '../models/event'
import type { OracleScenario } from '../engines/influence/types'
import type { QuestRecord } from '../models/quest'
import type { StateSnapshotRecord } from '../models/state'
import type { LearnedMatrixRecord } from './learnedMatrix'
import type { ForecastRunRecord } from '../../repo/forecastRepo'

export interface AppSettingRecord {
  key: string
  value: unknown
  updatedAt: number
}

export interface OracleScenarioRecord extends OracleScenario {
  id?: number
}

export const schemaVersion = 6

class GamnoDb extends Dexie {
  checkins!: EntityTable<CheckinRecord, 'id'>
  events!: EntityTable<AppEventRecord, 'id'>
  settings!: EntityTable<AppSettingRecord, 'key'>
  scenarios!: EntityTable<OracleScenarioRecord, 'id'>
  quests!: EntityTable<QuestRecord, 'id'>
  stateSnapshots!: EntityTable<StateSnapshotRecord, 'id'>
  learnedMatrices!: EntityTable<LearnedMatrixRecord, 'key'>
  forecastRuns!: EntityTable<ForecastRunRecord, 'id'>

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
      stateSnapshots: '++id,ts,level',
      learnedMatrices: '&key,metricSetHash,computedAt,trainedOnDays,lags',
      forecastRuns: '++id,ts,modelType',
    })
  }
}

export const db = new GamnoDb()
