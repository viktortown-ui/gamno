export type QuestStatus = 'active' | 'completed'

export interface QuestRecord {
  id?: number
  createdAt: number
  title: string
  metricTarget: string
  delta: number
  horizonDays: number
  status: QuestStatus
  predictedIndexLift: number
  completedAt?: number
  xpEarned?: number
  outcomeRu?: string
  goalId?: number
}
