import type { OracleScenarioDraft } from './types'

const DRAFT_KEY = 'gamno.oracleDraft'

export function saveOracleScenarioDraft(draft: OracleScenarioDraft): void {
  window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
}

export function consumeOracleScenarioDraft(): OracleScenarioDraft | undefined {
  const raw = window.localStorage.getItem(DRAFT_KEY)
  if (!raw) return undefined
  window.localStorage.removeItem(DRAFT_KEY)

  try {
    return JSON.parse(raw) as OracleScenarioDraft
  } catch {
    return undefined
  }
}
