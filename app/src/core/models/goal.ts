import type { MetricId } from '../metrics'

export type GoalStatus = 'active' | 'draft' | 'archived'

export interface GoalKeyResult {
  id: string
  metricId: MetricId
  direction: 'up' | 'down'
  target?: number
  progress?: number
  progressMode?: 'manual' | 'auto'
  note?: string
}

export interface GoalMissionAction {
  id: string
  title: string
  metricId: MetricId
  krId: string
  done: boolean
}

export interface GoalMission {
  id: string
  createdAt: number
  horizonDays: number
  actions: GoalMissionAction[]
  completedAt?: number
  rewardBadge?: string
}

export interface GoalRecord {
  id: string
  createdAt: number
  updatedAt: number
  title: string
  description?: string
  horizonDays: 7 | 14 | 30
  active: boolean
  weights: Record<string, number>
  okr: {
    objective: string
    keyResults: GoalKeyResult[]
  }
  activeMission?: GoalMission
  fruitBadge?: string
  template?: 'growth' | 'anti-storm' | 'energy-balance' | 'money'
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
  goalId: string
  goalScore: number
  goalGap: number
}
