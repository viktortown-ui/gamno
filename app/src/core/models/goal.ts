import type { MetricId } from '../metrics'

export type GoalStatus = 'active' | 'paused' | 'archived'

export interface GoalRecord {
  id?: number
  createdAt: number
  updatedAt: number
  title: string
  description?: string
  horizonDays: 7 | 14 | 30 | 90
  weights: Partial<Record<MetricId, number>>
  targetIndex?: number
  targetPCollapse?: number
  constraints?: {
    maxPCollapse?: number
    sirenCap?: 'green' | 'amber' | 'red'
    maxEntropy?: number
  }
  status: GoalStatus
}

export interface GoalEventRecord {
  id?: number
  ts: number
  goalId: number
  goalScore: number
  goalGap: number
}
