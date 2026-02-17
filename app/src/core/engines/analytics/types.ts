import type { CheckinRecord as BaseCheckinRecord } from '../../models/checkin'

export type MetricId = keyof Omit<BaseCheckinRecord, 'id' | 'ts'>

export type CheckinRecord = BaseCheckinRecord

export type AverageMap = Partial<Record<MetricId, number>>

export interface MetricDelta {
  metricId: MetricId
  delta: number
  direction: 'up' | 'down' | 'flat'
}

export interface IndexTrend {
  currentAvg: number
  previousAvg: number
  delta: number
  direction: 'up' | 'down' | 'flat'
}

export interface DashboardSummary {
  indexAvg7d: number
  indexTrend: IndexTrend
  streakDays: number
  metricAverages7d: AverageMap
  metricDelta7d: AverageMap
}

export interface AlertSignal {
  titleRu: string
  descriptionRu: string
  severity: 'red' | 'yellow' | 'info'
  suggestedActionsRu: readonly string[]
}
