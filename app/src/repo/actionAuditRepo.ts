import { db } from '../core/storage/db'
import type { ReproToken } from '../core/actions/audit'
import type { ModelHealthSnapshot } from '../core/engines/analytics/modelHealth'

export interface ActionAuditCandidateCompact {
  actionId: string
  score: number
  penalty: number
}

export interface HorizonAuditSummaryRecord {
  horizonDays: 3 | 7
  policyMode: 'risk' | 'balanced' | 'growth'
  actionId: string
  stats: {
    mean: number
    p10: number
    p50: number
    p90: number
    tail: number
    failRate: number
  }
}

export interface ActionAuditRecord {
  id?: number
  ts: number
  chosenActionId: string
  stateHash: string
  seed: number
  reproToken: ReproToken
  topCandidates: ActionAuditCandidateCompact[]
  horizonSummary?: HorizonAuditSummaryRecord[]
  whyTopRu: string[]
  modelHealth: ModelHealthSnapshot
  safeMode?: boolean
  gatesApplied?: string[]
  gateReasonsRu?: string[]
  fallbackPolicy?: 'risk' | 'balanced' | 'growth'
}

export async function saveActionAudit(record: ActionAuditRecord): Promise<ActionAuditRecord> {
  const id = await db.actionAudits.add(record)
  return { ...record, id }
}

export async function getLastActionAudit(): Promise<ActionAuditRecord | undefined> {
  return db.actionAudits.orderBy('ts').last()
}

export async function listActionAuditsByStateSeed(stateHash: string, seed: number): Promise<ActionAuditRecord[]> {
  return db.actionAudits.where('[stateHash+seed]').equals([stateHash, seed]).toArray()
}

export async function listRecentActionAudits(limit: number): Promise<ActionAuditRecord[]> {
  return db.actionAudits.orderBy('ts').reverse().limit(limit).toArray()
}
