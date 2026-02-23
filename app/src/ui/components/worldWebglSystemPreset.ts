export type WorldSystemPreset = 'normal' | 'compact'

export interface WorldSystemPresetSpec {
  orbitRadiusScale: number
  innerInclinationMaxDeg: number
  outerInclinationMaxDeg: number
}

const SYSTEM_PRESET_SPECS: Record<WorldSystemPreset, WorldSystemPresetSpec> = {
  normal: {
    orbitRadiusScale: 1,
    innerInclinationMaxDeg: 8,
    outerInclinationMaxDeg: 14,
  },
  compact: {
    orbitRadiusScale: 0.75,
    innerInclinationMaxDeg: 6,
    outerInclinationMaxDeg: 10,
  },
}

export function readWorldSystemPreset(): WorldSystemPreset {
  const preset = globalThis.localStorage?.getItem('worldSystemPreset')
  if (preset === 'compact') return 'compact'
  return 'normal'
}

export function getWorldSystemPresetSpec(): WorldSystemPresetSpec {
  return SYSTEM_PRESET_SPECS[readWorldSystemPreset()]
}
