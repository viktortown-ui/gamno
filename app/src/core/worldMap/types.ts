import type { FrameSnapshot } from '../frame/frameEngine'

export interface WorldMapViewport {
  width: number
  height: number
  padding?: number
}

export type WorldDomainId =
  | 'core'
  | 'risk'
  | 'mission'
  | 'stability'
  | 'forecast'
  | 'social'

export interface WorldMapMetrics {
  level: number
  risk: number
  esCollapse10: number
  failProbability: number
  budgetPressure: number
  safeMode: boolean
  sirenLevel: FrameSnapshot['regimeSnapshot']['sirenLevel']
}

export interface WorldMapRenderHints {
  hasStorm: boolean
  stormStrength: number
  tailRisk: number
  drawTailGlow: boolean
}

export interface WorldMapPlanet {
  id: string
  domainId: WorldDomainId
  order: number
  labelRu: string
  weight: number
  importance: number
  radius: number
  x: number
  y: number
  angle: number
  metrics: WorldMapMetrics
  renderHints: WorldMapRenderHints
}

export interface WorldMapDomain {
  id: WorldDomainId
  labelRu: string
  order: number
  orbitRadius: number
  ringWidth: number
  stormStrength: number
  planets: WorldMapPlanet[]
}

export interface WorldMapSnapshot {
  id: string
  ts: number
  seed: number
  viewport: { width: number; height: number; padding: number }
  center: { x: number; y: number }
  metrics: WorldMapMetrics
  rings: Array<{ id: string; domainId: WorldDomainId; radius: number; width: number; stormStrength: number }>
  storms: Array<{ id: string; domainId: WorldDomainId; intensity: number }>
  domains: WorldMapDomain[]
  planets: WorldMapPlanet[]
}
