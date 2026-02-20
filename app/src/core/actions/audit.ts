import type { ActionDefinition, ActionState } from './types'

export interface ReproToken {
  buildId: string
  seed: number
  stateHash: string
  catalogHash: string
  policyVersion: string
}

export function deterministicHash(value: unknown): string {
  const json = stableStringify(value)
  let hash = 2166136261
  for (let i = 0; i < json.length; i += 1) {
    hash ^= json.charCodeAt(i)
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)
  }
  return `h${(hash >>> 0).toString(16).padStart(8, '0')}`
}

export function buildStateHash(state: ActionState): string {
  return deterministicHash(state)
}

export function buildCatalogHash(actions: ActionDefinition[]): string {
  return deterministicHash(actions.map((item) => item.id))
}

export function buildWhyTopRu(reasons: string[]): string[] {
  return reasons.slice(0, 5).map((item) => `• ${item.replace(/^•\s*/, '')}`)
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
}
