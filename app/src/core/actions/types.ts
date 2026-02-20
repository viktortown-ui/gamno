export type ActionDomain = 'здоровье' | 'фокус' | 'карьера' | 'финансы' | 'социальное' | 'восстановление'

export type ActionTag = 'recovery' | 'goal' | 'risk' | 'shock'

export interface ActionCost {
  timeMin: number
  energy: number
  money: number
  timeDebt: number
  risk: number
  entropy: number
}

export interface ActionBudgetEnvelope {
  maxTimeMin: number
  maxEnergy: number
  maxMoney: number
  maxTimeDebt: number
  maxRisk: number
  maxEntropy: number
}

export interface ActionCostWeights {
  timeMin: number
  energy: number
  money: number
  timeDebt: number
  risk: number
  entropy: number
}

export interface ActionDelta {
  goalScore: number
  index: number
  pCollapse: number
  tailRisk: number
  debt: number
  sirenRisk: number
}

export interface ActionState {
  index: number
  pCollapse: number
  sirenLevel: number
  debtTotal: number
  goalGap: number
  recoveryScore: number
  shockBudget: number
  entropy: number
}

export interface ActionContext {
  seed: number
  mode: 'risk' | 'balanced' | 'growth'
}

export interface ActionDefinition {
  id: string
  titleRu: string
  domain: ActionDomain
  tags: ActionTag[]
  defaultCost: ActionCost
  preconditions: (state: ActionState, ctx: ActionContext) => boolean
  effectsFn: (state: ActionState, ctx: ActionContext) => ActionDelta
}
