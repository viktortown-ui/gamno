const WORLD_DEBUG_HUD_KEY = 'worldDebugHUD'
const WORLD_DEVELOPER_KEY = 'worldDeveloper'
const LEGACY_WORLD_DEBUG_HUD_KEYS = ['worldDebugOrbits', 'worldDebugLighting'] as const

function readFlagRaw(key: string): string | null {
  return globalThis.localStorage?.getItem(key)?.trim().toLowerCase() ?? null
}

function isFlagEnabledRaw(raw: string | null): boolean {
  return raw === '1' || raw === 'true'
}

let worldDebugHUDMigrationApplied = false

function isLegacyWorldDebugHUDKey(key: string): boolean {
  const normalized = key.trim()
  if (normalized === WORLD_DEBUG_HUD_KEY || normalized === WORLD_DEVELOPER_KEY) return false
  if (LEGACY_WORLD_DEBUG_HUD_KEYS.includes(normalized as (typeof LEGACY_WORLD_DEBUG_HUD_KEYS)[number])) return true
  return /^world.*hud/i.test(normalized)
}

function isDeveloperOverrideEnabled(): boolean {
  return isFlagEnabledRaw(readFlagRaw(WORLD_DEVELOPER_KEY))
}


export function resolveWorldDeveloperMode(input: { isDev: boolean; worldDeveloper: boolean }): boolean {
  return input.isDev || input.worldDeveloper
}

export function resolveWorldShowHud(input: { isDev: boolean; worldDebugHUD: boolean; worldDeveloper: boolean }): boolean {
  return resolveWorldDeveloperMode({ isDev: input.isDev, worldDeveloper: input.worldDeveloper }) && input.worldDebugHUD
}

export function resolveWorldDebugHUDVisibility(input: { isDev: boolean; worldDebugHUD: boolean; worldDeveloper: boolean }): boolean {
  return resolveWorldShowHud(input)
}

export function migrateWorldDebugHUDFlag(): void {
  if (worldDebugHUDMigrationApplied) return
  worldDebugHUDMigrationApplied = true

  const storage = globalThis.localStorage
  if (!storage) return

  const dynamicLegacyKeys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(
    (key): key is string => Boolean(key) && isLegacyWorldDebugHUDKey(key as string),
  )
  const allLegacyKeys = [...new Set([...LEGACY_WORLD_DEBUG_HUD_KEYS, ...dynamicLegacyKeys])]

  const hasNewFlagEnabled = isFlagEnabledRaw(readFlagRaw(WORLD_DEBUG_HUD_KEY))
  const hasLegacyFlagEnabled = allLegacyKeys.some((key) => isFlagEnabledRaw(readFlagRaw(key)))

  if (!hasNewFlagEnabled && hasLegacyFlagEnabled) {
    storage.setItem(WORLD_DEBUG_HUD_KEY, '1')
  }

  allLegacyKeys.forEach((key) => storage.removeItem(key))
}

export function isWorldDebugHUDVisible(): boolean {
  migrateWorldDebugHUDFlag()
  return resolveWorldDebugHUDVisibility({
    isDev: import.meta.env.DEV,
    worldDebugHUD: isFlagEnabledRaw(readFlagRaw(WORLD_DEBUG_HUD_KEY)),
    worldDeveloper: isDeveloperOverrideEnabled(),
  })
}

export function readWorldDebugHUDFlag(): boolean {
  migrateWorldDebugHUDFlag()
  return isFlagEnabledRaw(readFlagRaw(WORLD_DEBUG_HUD_KEY))
}

export function getWorldDebugHUDStorageKey(): string {
  return WORLD_DEBUG_HUD_KEY
}

export function canAccessWorldDebugHUDSetting(): boolean {
  return resolveWorldDeveloperMode({ isDev: import.meta.env.DEV, worldDeveloper: isDeveloperOverrideEnabled() })
}
