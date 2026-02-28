import type { MetricId } from '../metrics'

export type GoalStatus = 'active' | 'draft' | 'archived'
export type GoalModePresetId = 'balance' | 'recovery' | 'sprint' | 'finance' | 'social-shield'

export interface GoalManualTuning {
  weights: Record<string, number>
  krDirections?: Record<string, 'up' | 'down'>
  horizonDays?: 7 | 14 | 30
}

export interface GoalKeyResult {
  id: string
  metricId: MetricId
  direction: 'up' | 'down'
  target?: number
  progress?: number
  progressMode?: 'manual' | 'auto'
  note?: string
}

export interface GoalActiveMission {
  id: string
  goalId: string
  krKey: string
  templateId?: string
  title: string
  why?: string
  timeBandMinutes?: 5 | 15 | 30
  effectProfile?: 'small' | 'medium' | 'large'
  ifThenPlan?: string
  durationDays: 1 | 3
  startedAt: number
  endsAt: number
  expectedMin: number
  expectedMax: number
  expectedDefault: number
}

export interface GoalMissionHistoryItem {
  id: string
  goalId: string
  krKey: string
  templateId?: string
  title: string
  durationDays: 1 | 3
  completedAt: number
  coresAwarded: number
}

export interface GoalMissionControl {
  rerollDayKey?: string
  rerollsUsed?: number
  lastRerollAt?: number
  lastSuggestions?: Array<{ krKey: string; templateId: string; ts: number }>
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
  activeMission?: GoalActiveMission
  missionHistory?: GoalMissionHistoryItem[]
  missionControl?: GoalMissionControl
  modePresetId?: GoalModePresetId
  isManualTuning?: boolean
  manualTuning?: GoalManualTuning
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
