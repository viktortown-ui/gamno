import type { AntifragilityRules, MicroShockSuggestion, ShockSessionRecord } from '../../models/antifragility'
import type { RegimeId } from '../../models/regime'
import { createDenseDayKeys, dayKeyFromTs } from '../../utils/dayKey'

export interface AntifragilityDayInput {
  dayKey: string
  index: number
  pCollapse: number
  sirenLevel: 'green' | 'amber' | 'red'
  volatility: number
  entropy: number
  drift: number
  timeDebtTotal: number
  regimeId: RegimeId
}

export interface AntifragilityComputed {
  recoveryScore: number
  shockBudget: number
  antifragilityScore: number
  explainTop3: string[]
  allowShocks: boolean
  safetyModeRu: string
  trend: 'up' | 'down' | 'flat'
  suggestions: MicroShockSuggestion[]
}

export const defaultAntifragilityRules: AntifragilityRules = {
  thresholds: {
    maxPCollapseForShock: 0.2,
    maxDebtForShock: 1.6,
    highDebt: 2.4,
    minRecoveryForShock: 55,
    tailRiskHigh: 0.18,
  },
  weights: {
    baselineDrop: 0.45,
    sirenEscalation: 0.25,
    pCollapseRelief: 0.3,
    trend: 0.6,
    tailRisk: 0.4,
    amberRedPenalty: 25,
  },
  allowedShockTypes: ['нагрузка', 'фокус', 'социальный контакт'],
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function baseline(series: number[], i: number, window = 3): number {
  const from = Math.max(0, i - window)
  const slice = series.slice(from, i + 1)
  return slice.reduce((acc, v) => acc + v, 0) / Math.max(1, slice.length)
}

function severity(siren: 'green' | 'amber' | 'red'): number {
  if (siren === 'red') return 2
  if (siren === 'amber') return 1
  return 0
}

export function buildAntifragilitySeries(raw: AntifragilityDayInput[]): AntifragilityDayInput[] {
  if (!raw.length) return []
  const sorted = [...raw].sort((a, b) => a.dayKey.localeCompare(b.dayKey))
  const denseKeys = createDenseDayKeys(sorted[0].dayKey, sorted.at(-1)?.dayKey ?? sorted[0].dayKey)
  const byDay = new Map(sorted.map((item) => [item.dayKey, item]))
  const output: AntifragilityDayInput[] = []
  let last = sorted[0]
  denseKeys.forEach((key) => {
    const current = byDay.get(key) ?? { ...last, dayKey: key }
    output.push(current)
    last = current
  })
  return output
}

export function computeRecoveryScore(series: AntifragilityDayInput[], rules = defaultAntifragilityRules): number {
  if (!series.length) return 0
  const indexes = series.map((d) => d.index)
  const dips = series.flatMap((item, i) => {
    const base = baseline(indexes, i)
    const isDip = item.index < base - 0.35 || severity(item.sirenLevel) > severity(series[Math.max(0, i - 1)]?.sirenLevel ?? 'green')
    if (!isDip) return []
    let recoveryDays = 7
    for (let j = i + 1; j < series.length; j += 1) {
      if (series[j].index >= base || series[j].pCollapse <= rules.thresholds.maxPCollapseForShock) {
        recoveryDays = j - i
        break
      }
    }
    return [{ recoveryDays, pCollapseRelief: clamp((item.pCollapse - (series[Math.min(series.length - 1, i + recoveryDays)]?.pCollapse ?? item.pCollapse)) * 100, -10, 20) }]
  })

  if (!dips.length) return 80

  const avgRecovery = dips.reduce((acc, d) => acc + d.recoveryDays, 0) / dips.length
  const avgRelief = dips.reduce((acc, d) => acc + d.pCollapseRelief, 0) / dips.length
  const score = 100
    - avgRecovery * 11 * rules.weights.baselineDrop
    + avgRelief * rules.weights.pCollapseRelief

  return Number(clamp(score, 0, 100).toFixed(2))
}

function trendFromRecovery(last: number, previous: number): 'up' | 'down' | 'flat' {
  if (last > previous + 1.5) return 'up'
  if (last < previous - 1.5) return 'down'
  return 'flat'
}

export function computeShockBudget(input: { sirenLevel: 'green' | 'amber' | 'red'; debtTotal: number; pCollapse: number; regimeId: RegimeId }, rules = defaultAntifragilityRules): number {
  if (input.sirenLevel !== 'green') return 0
  if (input.debtTotal >= rules.thresholds.highDebt) return 0
  if (input.pCollapse >= rules.thresholds.maxPCollapseForShock) return 0
  if (input.debtTotal <= rules.thresholds.maxDebtForShock && input.regimeId >= 2) return 2
  return 1
}

function countUnsafeShocks(sessions: ShockSessionRecord[], series: AntifragilityDayInput[]): number {
  const byDay = new Map(series.map((item) => [item.dayKey, item]))
  return sessions.filter((session) => {
    const day = byDay.get(session.dayKey)
    return day ? day.sirenLevel !== 'green' : false
  }).length
}

export function computeAntifragility(params: {
  series: AntifragilityDayInput[]
  sessions: ShockSessionRecord[]
  tailRisk: number
  rules?: AntifragilityRules
}): AntifragilityComputed {
  const rules = params.rules ?? defaultAntifragilityRules
  const series = buildAntifragilitySeries(params.series)
  if (!series.length) {
    return {
      recoveryScore: 0,
      shockBudget: 0,
      antifragilityScore: 0,
      explainTop3: ['Недостаточно данных для оценки восстановления.', 'Добавьте чек-ин и снимок режима.', 'После этого появятся безопасные предложения.'],
      allowShocks: false,
      safetyModeRu: 'Только восстановление',
      trend: 'flat',
      suggestions: [],
    }
  }

  const recoveryScore = computeRecoveryScore(series, rules)
  const cut = Math.max(1, Math.floor(series.length / 2))
  const prevRecovery = computeRecoveryScore(series.slice(0, cut), rules)
  const trend = trendFromRecovery(recoveryScore, prevRecovery)
  const latest = series.at(-1) ?? series[0]
  const shockBudget = computeShockBudget({ sirenLevel: latest.sirenLevel, debtTotal: latest.timeDebtTotal, pCollapse: latest.pCollapse, regimeId: latest.regimeId }, rules)
  const unsafeShocks = countUnsafeShocks(params.sessions, series)
  const tailSensitivity = clamp((latest.volatility + latest.entropy + latest.drift) / 12, 0, 1)
  const trendBonus = trend === 'up' ? 12 : trend === 'down' ? -12 : 0
  const scoreRaw = recoveryScore * 0.62 + (1 - tailSensitivity) * 25 * rules.weights.tailRisk + trendBonus * rules.weights.trend - unsafeShocks * rules.weights.amberRedPenalty
  const antifragilityScore = Number(clamp(scoreRaw, 0, 100).toFixed(2))
  const allowShocks = shockBudget > 0 && recoveryScore >= rules.thresholds.minRecoveryForShock && params.tailRisk < rules.thresholds.tailRiskHigh

  const explainTop3 = [
    `Скорость восстановления: ${recoveryScore.toFixed(1)} / 100 (${trend === 'up' ? 'улучшается' : trend === 'down' ? 'замедляется' : 'стабильно'}).`,
    allowShocks ? `Разрешены микровстряски: бюджет ${shockBudget}/нед.` : 'Активирован режим только восстановления до снижения риска.',
    unsafeShocks > 0 ? `Выявлены рискованные встряски в небезопасные дни: ${unsafeShocks}.` : 'Нарушений безопасного режима не обнаружено.',
  ]

  return {
    recoveryScore,
    shockBudget: allowShocks ? shockBudget : 0,
    antifragilityScore,
    explainTop3,
    allowShocks,
    safetyModeRu: allowShocks ? 'Контролируемые микровстряски разрешены' : 'Только восстановление',
    trend,
    suggestions: generateMicroShocks({ allowShocks, budget: shockBudget, tailRiskHigh: params.tailRisk >= rules.thresholds.tailRiskHigh, allowedTypes: rules.allowedShockTypes }),
  }
}

export function generateMicroShocks(params: { allowShocks: boolean; budget: number; tailRiskHigh: boolean; allowedTypes: string[] }): MicroShockSuggestion[] {
  if (!params.allowShocks && !params.tailRiskHigh) return []
  const base: MicroShockSuggestion[] = params.tailRiskHigh
    ? [
      { type: 'buffer', titleRu: 'Буфер времени перед ключевой задачей', whyRu: 'Снижает хрупкость графика при неожиданностях.', durationMin: 20, intensity: 1, expectedEffect: 'больше запаса и меньше срыва ритма', safetyNoteRu: 'без медицинских обещаний' },
      { type: 'buffer', titleRu: 'Буфер внимания без уведомлений', whyRu: 'Уменьшает хвостовой риск от переключений.', durationMin: 25, intensity: 1, expectedEffect: 'ровный фокус и меньше дерганья', safetyNoteRu: 'без медицинских обещаний' },
      { type: 'buffer', titleRu: 'Буфер завершения дня', whyRu: 'Закрывает долги до накопления перегруза.', durationMin: 15, intensity: 1, expectedEffect: 'спокойнее вход в следующий день', safetyNoteRu: 'без медицинских обещаний' },
    ]
    : [
      { type: params.allowedTypes[0] ?? 'нагрузка', titleRu: 'Короткий сложный спринт', whyRu: 'Тренирует восстановление после контролируемого напряжения.', durationMin: 20, intensity: 2, expectedEffect: 'рост устойчивости к рабочему давлению', safetyNoteRu: 'без медицинских обещаний' },
      { type: params.allowedTypes[1] ?? 'фокус', titleRu: 'Фокус-блок с повышенной планкой', whyRu: 'Усиливает адаптацию к когнитивной нагрузке.', durationMin: 25, intensity: 3, expectedEffect: 'лучше удержание внимания в пике', safetyNoteRu: 'без медицинских обещаний' },
      { type: params.allowedTypes[2] ?? 'социальный контакт', titleRu: 'Небольшой социальный вызов', whyRu: 'Расширяет гибкость в коммуникации без перегруза.', durationMin: 15, intensity: 2, expectedEffect: 'спокойнее реакция на внешние сигналы', safetyNoteRu: 'без медицинских обещаний' },
    ]

  const limit = params.tailRiskHigh ? 3 : Math.min(3, Math.max(1, params.budget + 1))
  return base.slice(0, limit)
}

export function dayKeyNow(): string {
  return dayKeyFromTs(Date.now())
}
