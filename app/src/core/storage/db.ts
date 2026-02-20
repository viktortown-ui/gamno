import { Dexie, type EntityTable } from 'dexie'
import type { CheckinRecord } from '../models/checkin'
import type { SocialEventRecord, PersonRecord, SocialInsightRecord } from '../models/socialRadar'
import type { OracleScenario } from '../engines/influence/types'
import type { QuestRecord } from '../models/quest'
import type { StateSnapshotRecord } from '../models/state'
import type { LearnedMatrixRecord } from './learnedMatrix'
import type { ForecastRunRecord } from '../../repo/forecastRepo'
import type { RegimeSnapshotRecord } from '../models/regime'
import type { GoalEventRecord, GoalRecord } from '../models/goal'
import type { MultiverseRunRecord } from '../../repo/multiverseRepo'
import type { BlackSwanRunRecord, BlackSwanScenarioRecord } from '../../repo/blackSwanRepo'

export interface AppSettingRecord {
  key: string
  value: unknown
  updatedAt: number
}

export interface OracleScenarioRecord extends OracleScenario {
  id?: number
}

export const schemaVersion = 11

class GamnoDb extends Dexie {
  checkins!: EntityTable<CheckinRecord, 'id'>
  events!: EntityTable<SocialEventRecord, 'id'>
  people!: EntityTable<PersonRecord, 'id'>
  settings!: EntityTable<AppSettingRecord, 'key'>
  scenarios!: EntityTable<OracleScenarioRecord, 'id'>
  quests!: EntityTable<QuestRecord, 'id'>
  stateSnapshots!: EntityTable<StateSnapshotRecord, 'id'>
  learnedMatrices!: EntityTable<LearnedMatrixRecord, 'key'>
  forecastRuns!: EntityTable<ForecastRunRecord, 'id'>
  regimeSnapshots!: EntityTable<RegimeSnapshotRecord, 'id'>
  goals!: EntityTable<GoalRecord, 'id'>
  goalEvents!: EntityTable<GoalEventRecord, 'id'>
  multiverseRuns!: EntityTable<MultiverseRunRecord, 'id'>
  blackSwanScenarios!: EntityTable<BlackSwanScenarioRecord, 'id'>
  blackSwanRuns!: EntityTable<BlackSwanRunRecord, 'id'>
  socialInsights!: EntityTable<SocialInsightRecord, 'id'>

  constructor() {
    super('gamno-db')
    this.version(1).stores({
      checkins: '++id,ts',
      events: '++id,ts,type',
    })

    this.version(7).stores({
      checkins: '++id,ts',
      events: '++id,ts,type',
      settings: '&key,updatedAt',
      scenarios: '++id,ts,nameRu',
      quests: '++id,createdAt,status',
      stateSnapshots: '++id,ts,level',
      learnedMatrices: '&key,metricSetHash,computedAt,trainedOnDays,lags',
      forecastRuns: '++id,ts,modelType',
      regimeSnapshots: '++id,ts,dayKey,regimeId,sirenLevel',
    })

    this.version(schemaVersion).stores({
      checkins: '++id,ts',
      events: '++id,ts,dayKey,type,personId',
      people: '++id,nameAlias,updatedAt',
      settings: '&key,updatedAt',
      scenarios: '++id,ts,nameRu',
      quests: '++id,createdAt,status',
      stateSnapshots: '++id,ts,level',
      learnedMatrices: '&key,metricSetHash,computedAt,trainedOnDays,lags',
      forecastRuns: '++id,ts,modelType',
      regimeSnapshots: '++id,ts,dayKey,regimeId,sirenLevel',
      goals: '++id,createdAt,updatedAt,status',
      goalEvents: '++id,ts,goalId',
      multiverseRuns: '++id,ts',
      blackSwanScenarios: '++id,updatedAt,name',
      blackSwanRuns: '++id,ts,baseId',
      socialInsights: '++id,computedAt,windowDays,maxLag',
    })
  }
}

export const db = new GamnoDb()
