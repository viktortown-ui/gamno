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

  it('keeps generated palette away from near-black values', () => {
    const palette = planetPaletteFromId('planet:alpha', 77)
    const hsl = { h: 0, s: 0, l: 0 }
    palette.baseColor.getHSL(hsl)

    expect(hsl.l).toBeGreaterThanOrEqual(0.42)
    expect(hsl.s).toBeGreaterThanOrEqual(0.45)
    expect(Math.min(palette.baseColor.r, palette.baseColor.g, palette.baseColor.b)).toBeGreaterThan(0.08)
  })

  it('keeps pbr tuning values away from black-sphere defaults', () => {
    const tuning = planetMaterialTuningFromPalette('stone', planet)

    expect(tuning.metalness).toBeLessThan(0.15)
    expect(tuning.roughness).toBeGreaterThanOrEqual(0.65)
    expect(tuning.envMapIntensity).toBeGreaterThanOrEqual(1)
    expect(tuning.emissiveIntensity).toBeGreaterThan(0.05)
  })
})
