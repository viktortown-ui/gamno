import type { CheckinRecord } from '../models/checkin'
import type { QuestRecord } from '../models/quest'
import type { CoreStateSnapshot } from '../engines/stateEngine'
import { METRICS, type MetricId } from '../metrics'
import { computeTopLevers, defaultInfluenceMatrix } from '../engines/influence/influence'

export interface CollapseAction {
  what: string
  why: string
  effect: string
}

export interface CollapseAssessment {
  domainReliability: Record<'fin' | 'phys' | 'ment' | 'exec', number>
  systemReliability: number
  pCollapse: number
  sirenLevel: 'green' | 'amber' | 'red'
  weakestDomains: Array<{ id: 'fin' | 'phys' | 'ment' | 'exec'; reliability: number }>
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function score10(value: number): number {
  return clamp01(value / 10)
}

function scoreSleep(value: number): number {
  return clamp01(value / 8)
}

function scoreCash(value: number): number {
  return clamp01((value + 20000) / 40000)
}

function metricLabel(metricId: MetricId): string {
  return METRICS.find((metric) => metric.id === metricId)?.labelRu ?? metricId
}

export function assessCollapseRisk(snapshot: CoreStateSnapshot, latest?: CheckinRecord): CollapseAssessment {
  const stressPenalty = 1 - score10(latest?.stress ?? 5)
  const moodScore = score10(latest?.mood ?? 5)
  const energyScore = score10(latest?.energy ?? 5)
  const focusScore = score10(latest?.focus ?? 5)
  const productivityScore = score10(latest?.productivity ?? 5)
  const sleepScore = scoreSleep(latest?.sleepHours ?? 7)
  const cashScore = scoreCash(latest?.cashFlow ?? 0)

  const rFin = clamp01(0.65 * cashScore + 0.35 * clamp01(snapshot.index / 10))
  const rPhys = clamp01(0.45 * sleepScore + 0.35 * energyScore + 0.2 * clamp01(snapshot.stats.strength / 100))
  const rMent = clamp01(0.45 * stressPenalty + 0.35 * moodScore + 0.2 * clamp01(snapshot.stats.wisdom / 100))
  const rExec = clamp01(0.4 * focusScore + 0.35 * productivityScore + 0.25 * clamp01(snapshot.stats.intelligence / 100))

  const domainReliability = { fin: rFin, phys: rPhys, ment: rMent, exec: rExec }
  const systemReliability = rFin * rPhys * rMent * rExec
  const pCollapse = clamp01(1 - systemReliability)
  const sirenLevel = pCollapse > 0.35 ? 'red' : pCollapse >= 0.2 ? 'amber' : 'green'

  const weakestDomains = Object.entries(domainReliability)
    .map(([id, reliability]) => ({ id: id as 'fin' | 'phys' | 'ment' | 'exec', reliability }))
    .sort((a, b) => a.reliability - b.reliability)

  return { domainReliability, systemReliability, pCollapse, sirenLevel, weakestDomains }
}

function mapLever(lever: { from: MetricId; to: MetricId; suggestedDelta: number }): CollapseAction {
  const direction = lever.suggestedDelta > 0 ? 'поднять' : 'снизить'
  return {
    what: `${direction} «${metricLabel(lever.from)}» на ${Math.abs(lever.suggestedDelta).toFixed(1)} п.`,
    why: `Связка «${metricLabel(lever.from)} → ${metricLabel(lever.to)}» сейчас даёт самый быстрый сдвиг.`,
    effect: 'Ожидаемый эффект: уменьшение системной хрупкости и стабилизация режима.',
  }
}

export function buildDisarmProtocol(
  latest: CheckinRecord | undefined,
  collapse: CollapseAssessment,
  activeQuest: QuestRecord | undefined,
): CollapseAction[] {
  if (!latest) return []

  const actions = computeTopLevers(latest, defaultInfluenceMatrix, 3).map(mapLever)

  if (activeQuest) {
    actions.unshift({
      what: `Довести миссию «${activeQuest.title}» до статуса выполнено.`,
      why: 'Активная миссия уже встроена в текущий контур восстановления.',
      effect: 'Ожидаемый эффект: быстрый локальный спад Сирены и рост устойчивости.',
    })
  }

  const weakest = collapse.weakestDomains[0]
  if (weakest) {
    const weakestRu = weakest.id === 'fin'
      ? 'финансовый'
      : weakest.id === 'phys'
        ? 'физический'
        : weakest.id === 'ment'
          ? 'ментальный'
          : 'исполнительский'

    actions.push({
      what: `Поставить 20-минутный шаг на ${weakestRu} домен сегодня.`,
      why: `Это самый слабый домен (${(weakest.reliability * 100).toFixed(0)}% надёжности).`,
      effect: 'Ожидаемый эффект: выравнивание минимума и снижение вероятности срыва.',
    })
  }

  return actions.slice(0, 3)
}
