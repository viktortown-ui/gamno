import type { ActionBudgetEnvelope, ActionCost, ActionCostWeights } from './types'

export function penaltyScore(cost: ActionCost, weights: ActionCostWeights, budget: ActionBudgetEnvelope): number {
  const weighted =
    cost.timeMin * weights.timeMin
    + cost.energy * weights.energy
    + cost.money * weights.money
    + cost.timeDebt * weights.timeDebt
    + cost.risk * weights.risk
    + cost.entropy * weights.entropy

  const hardPenalty =
    violationPenalty(cost.timeMin - budget.maxTimeMin)
    + violationPenalty(cost.energy - budget.maxEnergy)
    + violationPenalty(cost.money - budget.maxMoney)
    + violationPenalty(cost.timeDebt - budget.maxTimeDebt)
    + violationPenalty(cost.risk - budget.maxRisk)
    + violationPenalty(cost.entropy - budget.maxEntropy)

  return Number((weighted + hardPenalty).toFixed(6))
}

function violationPenalty(excess: number): number {
  if (excess <= 0) return 0
  return 10000 + Number((excess * 1000).toFixed(6))
}
