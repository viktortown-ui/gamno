import type { FrameSnapshot } from '../core/frame/frameEngine'
import type { ModelHealthSnapshot } from '../core/engines/analytics/modelHealth'
import type { WorldMapPlanet, WorldMapSnapshot } from '../core/worldMap/types'

export interface HudSignal {
  key: 'mode' | 'safety' | 'collapse' | 'es' | 'failRate' | 'mission' | 'trust'
  label: string
  value: string
}

export interface WorldFxEvent {
  key: string
  type: 'pulse' | 'burst' | 'storm'
  planetId?: string
  intensity: number
}

const MODE_RU: Record<string, string> = {
  risk: 'Режим: риск',
  balanced: 'Режим: баланс',
  growth: 'Режим: рост',
}

function toPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

export function mapFrameToHudSignals(input: {
  frame: FrameSnapshot
  mode: string
  failRate: number
  trust?: Pick<ModelHealthSnapshot, 'grade' | 'reasonsRu'>
}): HudSignal[] {
  const { frame, mode, failRate, trust } = input
  const trustReason = trust?.reasonsRu?.[0] ?? 'Нет свежей диагностики.'

  return [
    { key: 'mode', label: 'Режим', value: MODE_RU[mode] ?? `Режим: ${mode}` },
    {
      key: 'safety',
      label: 'Безопасность',
      value: frame.regimeSnapshot.disarmProtocol.length ? 'SafeMode: ВКЛ' : `Сирена: ${String(frame.regimeSnapshot.sirenLevel).toUpperCase()}`,
    },
    { key: 'collapse', label: 'P(collapse)', value: toPercent(frame.regimeSnapshot.pCollapse) },
    { key: 'es', label: 'ES(97.5)', value: toPercent(frame.tailRiskSummary.esCollapse10 ?? 0) },
    { key: 'failRate', label: 'failRate', value: toPercent(failRate) },
    { key: 'mission', label: 'Миссия', value: frame.goal.active?.title ?? 'Без активной цели' },
    { key: 'trust', label: 'Доверие модели', value: `${(trust?.grade ?? 'n/a').toUpperCase()} · ${trustReason}` },
  ]
}

function firstPlanetByDomain(planets: WorldMapPlanet[]): Map<string, WorldMapPlanet> {
  const map = new Map<string, WorldMapPlanet>()
  planets.forEach((planet) => {
    if (!map.has(planet.domainId)) map.set(planet.domainId, planet)
  })
  return map
}

function domainDeltas(current: FrameSnapshot, previous: FrameSnapshot): Array<{ domainId: string; value: number }> {
  const currentState = current.stateSnapshot ?? { index: 0, level: 0, risk: 0 }
  const prevState = previous.stateSnapshot ?? { index: 0, level: 0, risk: 0 }
  const currentRegime = current.regimeSnapshot ?? { pCollapse: 0 }
  const prevRegime = previous.regimeSnapshot ?? { pCollapse: 0 }
  const currentGoal = current.goal ?? { goalScore: 0, active: undefined }
  const prevGoal = previous.goal ?? { goalScore: 0, active: undefined }
  const currentDebt = current.debt ?? { totalDebt: 0 }
  const prevDebt = previous.debt ?? { totalDebt: 0 }
  const currentTail = current.tailRiskSummary ?? { esCollapse10: 0 }
  const prevTail = previous.tailRiskSummary ?? { esCollapse10: 0 }
  const currentForecast = current.forecastSummary ?? { p50next7: 0 }
  const prevForecast = previous.forecastSummary ?? { p50next7: 0 }
  const currentSocial = current.socialSummary ?? { topInfluencesWeek: [] as string[] }
  const prevSocial = previous.socialSummary ?? { topInfluencesWeek: [] as string[] }

  return [
    { domainId: 'core', value: Math.abs(currentState.index - prevState.index) + Math.abs(currentState.level - prevState.level) },
    { domainId: 'risk', value: Math.abs(currentRegime.pCollapse - prevRegime.pCollapse) + Math.abs(currentState.risk - prevState.risk) },
    { domainId: 'mission', value: Math.abs(currentGoal.goalScore - prevGoal.goalScore) + Number(currentGoal.active?.title !== prevGoal.active?.title) * 0.25 },
    { domainId: 'stability', value: Math.abs(currentDebt.totalDebt - prevDebt.totalDebt) },
    { domainId: 'forecast', value: Math.abs((currentTail.esCollapse10 ?? 0) - (prevTail.esCollapse10 ?? 0)) + Math.abs(currentForecast.p50next7 - prevForecast.p50next7) * 0.03 },
    { domainId: 'social', value: Number(currentSocial.topInfluencesWeek[0] !== prevSocial.topInfluencesWeek[0]) * 0.4 },
  ]
}

export function buildWorldFxEvents(input: {
  current: FrameSnapshot
  previous?: FrameSnapshot
  snapshot: WorldMapSnapshot
}): WorldFxEvent[] {
  const { current, previous, snapshot } = input
  if (!previous) return []

  const byDomain = firstPlanetByDomain(snapshot.planets)
  const pulses: WorldFxEvent[] = []
  domainDeltas(current, previous)
    .sort((a, b) => (b.value - a.value) || a.domainId.localeCompare(b.domainId, 'ru'))
    .filter((item) => item.value > 0.0001)
    .slice(0, 3)
    .forEach((item, index) => {
      const planet = byDomain.get(item.domainId)
      if (!planet) return
      pulses.push({ key: `pulse:${index}:${planet.id}`, type: 'pulse', planetId: planet.id, intensity: Number(Math.min(1, item.value).toFixed(3)) })
    })

  const isSafeModeCleared = (previous.regimeSnapshot?.disarmProtocol?.length ?? 0) > 0 && (current.regimeSnapshot?.disarmProtocol?.length ?? 0) === 0
  const isLevelUp = (current.stateSnapshot?.level ?? 0) > (previous.stateSnapshot?.level ?? 0)
  const bursts = (isSafeModeCleared || isLevelUp) && snapshot.planets[0]
    ? [{ key: `burst:${snapshot.planets[0].id}`, type: 'burst' as const, planetId: snapshot.planets[0].id, intensity: 0.8 }]
    : []

  const stormDelta = ((current.tailRiskSummary.esCollapse10 ?? 0) - (previous.tailRiskSummary.esCollapse10 ?? 0))
    + (current.regimeSnapshot.pCollapse - previous.regimeSnapshot.pCollapse)
  const storm = stormDelta > 0.0001
    ? [{ key: 'storm:global', type: 'storm' as const, intensity: Number(Math.min(1, stormDelta * 4).toFixed(3)) }]
    : []

  return [...pulses, ...bursts, ...storm]
}
