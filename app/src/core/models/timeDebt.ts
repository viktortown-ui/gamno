export interface DebtBreakdown {
  sleepDebt: number
  recoveryDebt: number
  focusDebt: number
  socialDebt?: number
}

export interface TimeDebtTotals {
  totalDebt: number
  debtIndex: number
  debtTrend: 'up' | 'down' | 'flat'
}

export interface TimeDebtEffectEstimate {
  deltaIndex: number
  deltaPCollapse: number
  deltaGoalScore: number
}

export interface TimeDebtProtocolAction {
  actionId: string
  titleRu: string
  reasonRu: string
  domain: keyof DebtBreakdown
  supportsGoal: boolean
  isDischarge: boolean
  effect: TimeDebtEffectEstimate
}

export interface TimeDebtSnapshotRecord {
  id?: number
  ts: number
  dayKey: string
  debts: DebtBreakdown
  totals: TimeDebtTotals
  explainTop3: string[]
  protocol: string[]
  protocolActions: TimeDebtProtocolAction[]
  effectEstimate: TimeDebtEffectEstimate
  links: {
    checkinId?: number
    questId?: number
  }
}

export interface TimeDebtRules {
  targets: {
    sleepHours: number
  }
  tolerances: {
    stressHigh: number
    focusLow: number
  }
  weights: {
    sleep: number
    recovery: number
    focus: number
    social: number
  }
  decay: {
    sleep: number
    recovery: number
    focus: number
    social: number
  }
}

export interface TimeDebtSettingsRecord {
  key: 'time-debt-rules'
  value: TimeDebtRules
  updatedAt: number
}
