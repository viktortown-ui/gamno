export type ThemeMode = 'dark' | 'light'
export type MotionMode = 'normal' | 'reduced'
export type TransparencyMode = 'glass' | 'reduced'
export type WorldUiVariant = 'instrument' | 'cinematic'

export interface AppearanceSettings {
  theme: ThemeMode
  motion: MotionMode
  transparency: TransparencyMode
  worldUiVariant: WorldUiVariant
}

const APPEARANCE_KEY = 'gamno-appearance-v1'

export function loadAppearanceSettings(): AppearanceSettings {
  if (typeof window === 'undefined') return { theme: 'dark', motion: 'normal', transparency: 'glass', worldUiVariant: 'instrument' }

  const systemReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const initial: AppearanceSettings = { theme: 'dark', motion: systemReduced ? 'reduced' : 'normal', transparency: 'glass', worldUiVariant: 'instrument' }

  const raw = window.localStorage.getItem(APPEARANCE_KEY)
  if (!raw) return initial

  try {
    const parsed = JSON.parse(raw) as Partial<AppearanceSettings>
    return {
      theme: parsed.theme === 'light' ? 'light' : 'dark',
      motion: parsed.motion === 'reduced' ? 'reduced' : 'normal',
      transparency: parsed.transparency === 'reduced' ? 'reduced' : 'glass',
      worldUiVariant: parsed.worldUiVariant === 'cinematic' ? 'cinematic' : 'instrument',
    }
  } catch {
    return initial
  }
}

export function saveAppearanceSettings(settings: AppearanceSettings) {
  window.localStorage.setItem(APPEARANCE_KEY, JSON.stringify(settings))
}
