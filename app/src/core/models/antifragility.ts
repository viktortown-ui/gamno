export type ShockSessionStatus = 'planned' | 'done' | 'skipped'

export interface AntifragilitySnapshotRecord {
  id?: number
  ts: number
  dayKey: string
  recoveryScore: number
  shockBudget: number
  antifragilityScore: number
  explainTop3: string[]
  links: {
    checkinId?: number
    questId?: number
    regimeSnapshotId?: number
  }
}

export interface ShockSessionRecord {
  id?: number
  ts: number
  dayKey: string
  type: string
  intensity: 1 | 2 | 3 | 4 | 5
  plannedDurationMin: number
  status: ShockSessionStatus
  outcomeNote?: string
  links: {
    questId?: number
  }
}

export interface AntifragilityRules {
  thresholds: {
    maxPCollapseForShock: number
    maxDebtForShock: number
    highDebt: number
    minRecoveryForShock: number
    tailRiskHigh: number
  }
  weights: {
    baselineDrop: number
    sirenEscalation: number
    pCollapseRelief: number
    trend: number
    tailRisk: number
    amberRedPenalty: number
  }
  allowedShockTypes: string[]
}

export interface AntifragilitySettingsRecord {
  key: 'antifragility-rules'
  value: AntifragilityRules
  updatedAt: number
}

export interface MicroShockSuggestion {
  type: string
  titleRu: string
  whyRu: string
  durationMin: number
  intensity: 1 | 2 | 3 | 4 | 5
  expectedEffect: string
  safetyNoteRu: string
}
