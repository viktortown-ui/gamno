import type { PolicyMode, PolicyResult } from '../core/engines/policy'
import type { ActionAuditRecord } from '../repo/actionAuditRepo'

const POLICY_ORDER: PolicyMode[] = ['risk', 'balanced', 'growth']

type HorizonDays = 3 | 7

export function getPolicyCards(params: {
  results: PolicyResult[]
  audit: ActionAuditRecord | null
  horizon: HorizonDays
}): Array<{
  mode: PolicyMode
  nameRu: string
  bestTitle: string
  candidates: Array<{
    actionId: string
    titleRu: string
    score: number
    penalty: number
    p50: number
    p90: number
    tail: number
    failRate: number
  }>
}> {
  const byMode = new Map(params.results.map((item) => [item.mode, item]))

  return POLICY_ORDER.map((mode) => {
    const policy = byMode.get(mode)
    const titleByAction = new Map<string, string>()
    if (policy) {
      titleByAction.set(policy.best.action.id, policy.best.action.titleRu)
      policy.ranked.forEach((candidate) => titleByAction.set(candidate.action.id, candidate.action.titleRu))
    }

    const topCandidates = (params.audit?.horizonSummary ?? [])
      .filter((item) => item.policyMode === mode && item.horizonDays === params.horizon)
      .sort((a, b) => {
        if (b.stats.p50 !== a.stats.p50) return b.stats.p50 - a.stats.p50
        if (b.stats.p90 !== a.stats.p90) return b.stats.p90 - a.stats.p90
        return a.actionId.localeCompare(b.actionId)
      })
      .slice(0, 3)
      .map((item) => {
        const fallback = policy?.ranked.find((ranked) => ranked.action.id === item.actionId)
        return {
          actionId: item.actionId,
          titleRu: titleByAction.get(item.actionId) ?? item.actionId,
          score: fallback?.score ?? 0,
          penalty: Number(fallback?.penalty ?? 0),
          p50: item.stats.p50,
          p90: item.stats.p90,
          tail: item.stats.tail,
          failRate: item.stats.failRate,
        }
      })

    return {
      mode,
      nameRu: policy?.nameRu ?? '—',
      bestTitle: policy?.best.action.titleRu ?? '—',
      candidates: topCandidates,
    }
  })
}
