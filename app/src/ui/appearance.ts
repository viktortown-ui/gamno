export type ThemeMode = 'dark' | 'light'
export type MotionMode = 'normal' | 'reduced'
export type TransparencyMode = 'glass' | 'reduced'
export type WorldUiVariant = 'instrument' | 'cinematic'
export type WorldRenderMode = 'svg' | 'webgl'

export interface AppearanceSettings {
  theme: ThemeMode
  motion: MotionMode
  transparency: TransparencyMode
  worldUiVariant: WorldUiVariant
  worldRenderMode: WorldRenderMode
}

const APPEARANCE_KEY = 'gamno-appearance-v1'

export function loadAppearanceSettings(): AppearanceSettings {
  if (typeof window === 'undefined') return { theme: 'dark', motion: 'normal', transparency: 'glass', worldUiVariant: 'instrument', worldRenderMode: 'webgl' }

  const systemReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const initial: AppearanceSettings = { theme: 'dark', motion: systemReduced ? 'reduced' : 'normal', transparency: 'glass', worldUiVariant: 'instrument', worldRenderMode: 'webgl' }

  const raw = window.localStorage.getItem(APPEARANCE_KEY)
  if (!raw) return initial

  try {
    const parsed = JSON.parse(raw) as Partial<AppearanceSettings>
    return {
      theme: parsed.theme === 'light' ? 'light' : 'dark',
      motion: parsed.motion === 'reduced' ? 'reduced' : 'normal',
      transparency: parsed.transparency === 'reduced' ? 'reduced' : 'glass',
      worldUiVariant: parsed.worldUiVariant === 'cinematic' ? 'cinematic' : 'instrument',
      worldRenderMode: parsed.worldRenderMode === 'svg' ? 'svg' : 'webgl',
    }
  } catch {
    return initial
  }
}

export function saveAppearanceSettings(settings: AppearanceSettings) {
  window.localStorage.setItem(APPEARANCE_KEY, JSON.stringify(settings))
}
