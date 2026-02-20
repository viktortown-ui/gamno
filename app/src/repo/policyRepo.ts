import { db } from '../core/storage/db'
import type { PolicyMode, PolicyConstraints } from '../core/engines/policy'

export interface PolicyRecord {
  id?: number
  nameRu: string
  mode: PolicyMode
  weights: Record<string, number>
  constraints: PolicyConstraints
  createdAt: number
  updatedAt: number
  isActive: boolean
}

export interface PolicyRunRecord {
  id?: number
  ts: number
  stateRef: { stateSnapshotId?: number; regimeSnapshotId?: number; timeDebtSnapshotId?: number }
  goalRef?: { id: number; title: string }
  inputs: unknown
  outputs: unknown
  chosenPolicyId?: number
  chosenActionId?: string
  audit: {
    weightsSource: 'manual' | 'learned' | 'mixed'
    mix: number
    tailRiskRunTs?: number
    forecastConfidence: 'низкая' | 'средняя' | 'высокая'
  }
}

export async function listPolicies(): Promise<PolicyRecord[]> {
  return db.policies.orderBy('updatedAt').reverse().toArray()
}

export async function createPolicy(input: Omit<PolicyRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<PolicyRecord> {
  const now = Date.now()
  const row: PolicyRecord = { ...input, createdAt: now, updatedAt: now }
  const id = await db.policies.add(row)
  return { ...row, id }
}

export async function updatePolicy(id: number, patch: Partial<Omit<PolicyRecord, 'id' | 'createdAt'>>): Promise<PolicyRecord | undefined> {
  const existing = await db.policies.get(id)
  if (!existing) return undefined
  const next: PolicyRecord = { ...existing, ...patch, id, updatedAt: Date.now() }
  await db.policies.put(next)
  return next
}

export async function setActivePolicy(id: number): Promise<void> {
  await db.transaction('rw', db.policies, async () => {
    const all = await db.policies.toArray()
    for (const policy of all) {
      await db.policies.put({ ...policy, isActive: policy.id === id, updatedAt: Date.now() })
    }
  })
}

export async function getActivePolicy(): Promise<PolicyRecord | undefined> {
  const all = await db.policies.orderBy('updatedAt').reverse().toArray()
  return all.find((item) => item.isActive)
}

export async function saveRun(run: PolicyRunRecord): Promise<PolicyRunRecord> {
  const id = await db.policyRuns.add(run)
  return { ...run, id }
}

export async function getLastRun(): Promise<PolicyRunRecord | undefined> {
  return db.policyRuns.orderBy('ts').last()
}

export async function listRuns(limit = 20): Promise<PolicyRunRecord[]> {
  return db.policyRuns.orderBy('ts').reverse().limit(limit).toArray()
}
