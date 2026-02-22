import { describe, expect, it } from 'vitest'

import type { WorldMapPlanet } from '../../core/worldMap/types'
import { planetMaterialTuningFromPalette, planetPaletteFromId } from './worldWebglPlanetStyle'

const planet: WorldMapPlanet = {
  id: 'planet:alpha',
  domainId: 'core',
  order: 1,
  labelRu: 'Альфа',
  weight: 1,
  importance: 1,
  radius: 12,
  x: 100,
  y: 100,
  angle: 0.3,
  metrics: { level: 3, risk: 0.3, esCollapse10: 0.2, failProbability: 0.1, budgetPressure: 0.2, safeMode: false, sirenLevel: 'green' },
  renderHints: { hasStorm: false, stormStrength: 0, tailRisk: 0, drawTailGlow: false },
}

describe('worldWebglPlanetStyle', () => {
  it('returns deterministic palette for same id and seed', () => {
    const first = planetPaletteFromId('planet:alpha', 77)
    const second = planetPaletteFromId('planet:alpha', 77)

    expect(first.type).toBe(second.type)
    expect(first.baseColor.getHexString()).toBe(second.baseColor.getHexString())
    expect(first.emissiveColor.getHexString()).toBe(second.emissiveColor.getHexString())
  })

  it('keeps pbr tuning values away from black-sphere defaults', () => {
    const tuning = planetMaterialTuningFromPalette('stone', planet)

    expect(tuning.metalness).toBeLessThan(0.15)
    expect(tuning.roughness).toBeGreaterThanOrEqual(0.65)
    expect(tuning.envMapIntensity).toBeGreaterThan(0.8)
    expect(tuning.emissiveIntensity).toBeGreaterThan(0.05)
  })
})
