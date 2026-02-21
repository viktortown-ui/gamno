import type { PolicyActionEvaluation, PolicyConstraints, PolicyMode, PolicyResult } from '../core/engines/policy'
import type { ActionAuditRecord, HorizonAuditSummaryRecord } from '../repo/actionAuditRepo'

const POLICY_ORDER: PolicyMode[] = ['risk', 'balanced', 'growth']

type HorizonDays = 3 | 7

function byStatsDesc(a: HorizonAuditSummaryRecord, b: HorizonAuditSummaryRecord): number {
  if (b.stats.p50 !== a.stats.p50) return b.stats.p50 - a.stats.p50
  if (b.stats.p90 !== a.stats.p90) return b.stats.p90 - a.stats.p90
  return a.actionId.localeCompare(b.actionId)
}

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
      .sort(byStatsDesc)
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

export function getBriefingBullets(params: {
  selected: PolicyResult | undefined
  whyTopRu: string[]
  constraints: PolicyConstraints
}): { summary: string; why: string[]; risks: string[] } {
  const { selected, whyTopRu, constraints } = params
  if (!selected) {
    return {
      summary: 'Нет данных для рекомендации.',
      why: ['Обновите данные и пересчитайте автопилот.'],
      risks: ['Риски не оценены.'],
    }
  }

  const top = selected.best
  return {
    summary: `Сейчас лучше: «${top.action.titleRu}» в режиме «${selected.nameRu}».`,
    why: whyTopRu.slice(0, 3),
    risks: [
      `Tail: ${(top.deltas.tailRisk * 100).toFixed(1)} п.п. (лимит косвенно через maxPCollapse ${ (constraints.maxPCollapse * 100).toFixed(1)} п.п.).`,
      `Fail (proxy через siren): ${(top.deltas.sirenRisk * 100).toFixed(1)} п.п. при лимите ${(constraints.sirenCap * 100).toFixed(1)} п.п..`,
      `Budget debt: ${(top.deltas.debt * 100).toFixed(1)} п.п. при лимите ${(constraints.maxDebtGrowth * 100).toFixed(1)} п.п..`,
    ],
  }
}

export function getPolicyDuelSummary(params: {
  horizonSummary: HorizonAuditSummaryRecord[]
  horizon: HorizonDays
}): { p50: string; tail: string; failRate: string; budget: string } {
  const filtered = params.horizonSummary
    .filter((item) => item.horizonDays === params.horizon)
    .sort((a, b) => a.policyMode.localeCompare(b.policyMode) || a.actionId.localeCompare(b.actionId))

  if (!filtered.length) {
    return { p50: '—', tail: '—', failRate: '—', budget: '—' }
  }

  const bestBy = <T extends number>(getter: (row: HorizonAuditSummaryRecord) => T, direction: 'asc' | 'desc'): HorizonAuditSummaryRecord => {
    return filtered.reduce((best, row) => {
      const current = getter(row)
      const chosen = getter(best)
      if (direction === 'desc' ? current > chosen : current < chosen) return row
      if (current === chosen && row.stats.p90 > best.stats.p90) return row
      if (current === chosen && row.stats.p90 === best.stats.p90 && row.actionId < best.actionId) return row
      return best
    }, filtered[0])
  }

  const p50 = bestBy((item) => item.stats.p50, 'desc')
  const tail = bestBy((item) => item.stats.tail, 'asc')
  const fail = bestBy((item) => item.stats.failRate, 'asc')
  const budget = bestBy((item) => Math.abs(item.stats.p90 - item.stats.p10), 'asc')

  return {
    p50: `${p50.policyMode}/${p50.actionId}`,
    tail: `${tail.policyMode}/${tail.actionId}`,
    failRate: `${fail.policyMode}/${fail.actionId}`,
    budget: `${budget.policyMode}/${budget.actionId}`,
  }
}

export function getDrilldownCandidates(params: {
  selected: PolicyResult | undefined
  constraints: PolicyConstraints
  topK: number
}): Array<{ id: string; titleRu: string; deltas: PolicyActionEvaluation['deltas']; warnings: string[] }> {
  if (!params.selected) return []

  return params.selected.ranked.slice(0, params.topK).map((item) => {
    const warnings: string[] = []
    if (item.deltas.pCollapse > params.constraints.maxPCollapse) warnings.push('P(collapse) выше лимита.')
    if (item.deltas.sirenRisk > params.constraints.sirenCap) warnings.push('Риск Сирены выше лимита.')
    if (item.deltas.debt > params.constraints.maxDebtGrowth) warnings.push('Рост долга выше лимита.')
    return {
      id: item.action.id,
      titleRu: item.action.titleRu,
      deltas: item.deltas,
      warnings,
    }
  })
}

export function getModelHealthView(modelHealth: Record<string, unknown> | null | undefined): { level: 'high' | 'medium' | 'low'; reason: string } {
  if (!modelHealth) return { level: 'low', reason: 'Нет данных о здоровье модели.' }
  const explicitLevel = modelHealth.level
  const reason = typeof modelHealth.reason === 'string' ? modelHealth.reason : ''
  if (explicitLevel === 'high' || explicitLevel === 'medium' || explicitLevel === 'low') {
    return { level: explicitLevel, reason: reason || 'Уровень предоставлен движком.' }
  }
  if (modelHealth.placeholder) {
    return { level: 'medium', reason: 'Временная оценка: используем placeholder из аудита.' }
  }
  return { level: 'low', reason: reason || 'Недостаточно сигналов для оценки.' }
}
