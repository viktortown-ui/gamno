export type ThemeMode = 'dark' | 'light'
export type MotionMode = 'normal' | 'reduced'

export interface AppearanceSettings {
  theme: ThemeMode
  motion: MotionMode
}

const APPEARANCE_KEY = 'gamno-appearance-v1'

export function loadAppearanceSettings(): AppearanceSettings {
  if (typeof window === 'undefined') return { theme: 'dark', motion: 'normal' }

  const systemReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const initial: AppearanceSettings = { theme: 'dark', motion: systemReduced ? 'reduced' : 'normal' }

  const raw = window.localStorage.getItem(APPEARANCE_KEY)
  if (!raw) return initial

  try {
    const parsed = JSON.parse(raw) as Partial<AppearanceSettings>
    return {
      theme: parsed.theme === 'light' ? 'light' : 'dark',
      motion: parsed.motion === 'reduced' ? 'reduced' : 'normal',
    }
  } catch {
    return initial
  }
}

export function saveAppearanceSettings(settings: AppearanceSettings) {
  window.localStorage.setItem(APPEARANCE_KEY, JSON.stringify(settings))
}
