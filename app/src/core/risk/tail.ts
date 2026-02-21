import { computeTailRisk } from './tailRisk'

export function valueAtRisk(losses: number[], alpha: number): number {
  return computeTailRisk(losses, alpha).var
}

export function conditionalVaR(losses: number[], alpha: number): number {
  return computeTailRisk(losses, alpha).es
}
