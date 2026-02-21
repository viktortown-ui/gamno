import type { FrameSnapshot } from '../frame/frameEngine'
import type { WorldDomainId, WorldMapDomain, WorldMapMetrics, WorldMapPlanet, WorldMapSnapshot, WorldMapViewport } from './types'

const DOMAIN_ORDER: Array<{ id: WorldDomainId; labelRu: string; planetLabelsRu: [string, string] }> = [
  { id: 'core', labelRu: 'Ядро', planetLabelsRu: ['Индекс', 'Уровень'] },
  { id: 'risk', labelRu: 'Риск', planetLabelsRu: ['Коллапс', 'Tail ES'] },
  { id: 'mission', labelRu: 'Миссия', planetLabelsRu: ['Цель', 'Квест'] },
  { id: 'stability', labelRu: 'Стабильность', planetLabelsRu: ['Долг', 'Антихрупкость'] },
  { id: 'forecast', labelRu: 'Прогноз', planetLabelsRu: ['P50+7', 'Уверенность'] },
  { id: 'social', labelRu: 'Соц.радар', planetLabelsRu: ['Влияния', 'Автопилот'] },
]

const SIREN_WEIGHT: Record<FrameSnapshot['regimeSnapshot']['sirenLevel'], number> = {
  green: 0,
  amber: 0.5,
  red: 1,
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

function round3(value: number): number {
  return Number(value.toFixed(3))
}

function hashString(input: string): number {
  let hash = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function seededUnit(seed: number, key: string): number {
  const h = hashString(`${seed}:${key}`)
  return (h % 10000) / 10000
}

function confidenceScore(label: FrameSnapshot['forecastSummary']['confidence']): number {
  if (label === 'высокая') return 1
  if (label === 'средняя') return 0.6
  return 0.25
}

function toMetrics(frame: FrameSnapshot): WorldMapMetrics {
  const risk = clamp(frame.stateSnapshot.risk / 10, 0, 1)
  const esCollapse10 = clamp(frame.tailRiskSummary.esCollapse10 ?? frame.tailRiskSummary.cvar ?? 0, 0, 1)
  const failProbability = clamp(frame.regimeSnapshot.pCollapse, 0, 1)
  const budgetPressure = clamp((frame.debt.totalDebt + Math.max(0, -frame.goal.gap)) / 100, 0, 1)
  const safeMode = frame.regimeSnapshot.sirenLevel === 'red' || frame.regimeSnapshot.pCollapse >= 0.35

  return {
    level: Math.max(1, Math.round(frame.stateSnapshot.level)),
    risk: round3(risk),
    esCollapse10: round3(esCollapse10),
    failProbability: round3(failProbability),
    budgetPressure: round3(budgetPressure),
    safeMode,
    sirenLevel: frame.regimeSnapshot.sirenLevel,
  }
}

function orbitRadius(baseRadius: number, metrics: WorldMapMetrics): number {
  const riskEffect = metrics.risk * 0.2
  const sirenEffect = SIREN_WEIGHT[metrics.sirenLevel] * 0.12
  const safeModeEffect = metrics.safeMode ? 0.08 : 0
  return baseRadius * (1 + riskEffect + sirenEffect + safeModeEffect)
}

function planetVisualRadius(weight: number, importance: number): number {
  return round3(8 + clamp(weight, 0, 1) * 16 + clamp(importance, 0, 1) * 10)
}

function buildDomainPlanets(params: {
  domain: (typeof DOMAIN_ORDER)[number]
  domainIndex: number
  domainOrbit: number
  metrics: WorldMapMetrics
  center: { x: number; y: number }
  seed: number
  viewport: { width: number; height: number; padding: number }
  frame: FrameSnapshot
}): WorldMapPlanet[] {
  const { domain, domainIndex, domainOrbit, metrics, center, seed, viewport, frame } = params
  const risk = metrics.risk
  const confidence = confidenceScore(frame.forecastSummary.confidence)
  const baseValues: [number, number] = [
    clamp((risk + (domainIndex + 1) / DOMAIN_ORDER.length) / 2, 0, 1),
    clamp((confidence + (1 - risk)) / 2, 0, 1),
  ]

  return domain.planetLabelsRu.map((labelRu, planetIndex) => {
    const order = domainIndex * 10 + planetIndex
    const id = `planet:${domain.id}:${planetIndex}`
    const weight = round3(baseValues[planetIndex])
    const importance = round3(clamp((metrics.failProbability + weight + metrics.budgetPressure) / 3, 0, 1))
    const jitter = (seededUnit(seed, id) - 0.5) * 0.22
    const angle = round3(((Math.PI * 2 * domainIndex) / DOMAIN_ORDER.length) + (planetIndex * 0.18) + jitter)
    const radialOffset = domainOrbit + (planetIndex === 0 ? -8 : 10)

    const x = round3(clamp(center.x + Math.cos(angle) * radialOffset, viewport.padding, viewport.width - viewport.padding))
    const y = round3(clamp(center.y + Math.sin(angle) * radialOffset, viewport.padding, viewport.height - viewport.padding))

    const stormStrength = round3(clamp((metrics.esCollapse10 + metrics.failProbability + (planetIndex === 0 ? risk : metrics.budgetPressure)) / 3, 0, 1))

    return {
      id,
      domainId: domain.id,
      order,
      labelRu,
      weight,
      importance,
      radius: planetVisualRadius(weight, importance),
      x,
      y,
      angle,
      metrics,
      renderHints: {
        hasStorm: stormStrength >= 0.45,
        stormStrength,
        tailRisk: round3(clamp(metrics.esCollapse10 * (0.8 + planetIndex * 0.2), 0, 1)),
        drawTailGlow: metrics.esCollapse10 >= 0.3 || frame.tailRiskSummary.pRed7d >= 0.2,
      },
    }
  })
}

export function buildWorldMapSnapshot(frame: FrameSnapshot, seed: number, viewport: WorldMapViewport): WorldMapSnapshot {
  const normalizedViewport = {
    width: Math.max(320, Math.round(viewport.width)),
    height: Math.max(240, Math.round(viewport.height)),
    padding: Math.max(8, Math.round(viewport.padding ?? 24)),
  }
  const center = { x: round3(normalizedViewport.width / 2), y: round3(normalizedViewport.height / 2) }
  const metrics = toMetrics(frame)

  const minDim = Math.min(normalizedViewport.width, normalizedViewport.height)
  const baseOrbit = minDim * 0.17

  const domains: WorldMapDomain[] = DOMAIN_ORDER.map((domain, domainIndex) => {
    const orbit = round3(orbitRadius(baseOrbit + domainIndex * 24, metrics))
    const ringWidth = round3(8 + metrics.risk * 5 + domainIndex * 0.4)
    const planets = buildDomainPlanets({
      domain,
      domainIndex,
      domainOrbit: orbit,
      metrics,
      center,
      seed,
      viewport: normalizedViewport,
      frame,
    })

    const stormStrength = round3(clamp(planets.reduce((sum, item) => sum + item.renderHints.stormStrength, 0) / planets.length, 0, 1))

    return {
      id: domain.id,
      labelRu: domain.labelRu,
      order: domainIndex,
      orbitRadius: orbit,
      ringWidth,
      stormStrength,
      planets,
    }
  })

  const planets = domains.flatMap((domain) => domain.planets).sort((a, b) => (a.order - b.order) || a.id.localeCompare(b.id, 'ru'))
  const rings = domains.map((domain) => ({
    id: `ring:${domain.id}`,
    domainId: domain.id,
    radius: domain.orbitRadius,
    width: domain.ringWidth,
    stormStrength: domain.stormStrength,
  }))
  const storms = domains
    .filter((domain) => domain.stormStrength > 0.33)
    .map((domain) => ({ id: `storm:${domain.id}`, domainId: domain.id, intensity: domain.stormStrength }))

  return {
    id: `world-map:${frame.dayKey}:${seed}:${normalizedViewport.width}x${normalizedViewport.height}`,
    ts: frame.ts,
    seed,
    viewport: normalizedViewport,
    center,
    metrics,
    rings,
    storms,
    domains,
    planets,
  }
}
