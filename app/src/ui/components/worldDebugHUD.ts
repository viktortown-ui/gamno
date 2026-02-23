const WORLD_DEBUG_HUD_KEY = 'worldDebugHUD'
const LEGACY_WORLD_DEBUG_HUD_KEYS = ['worldDebugOrbits', 'worldDebugLighting'] as const

function readFlagRaw(key: string): string | null {
  return globalThis.localStorage?.getItem(key)?.trim().toLowerCase() ?? null
}

function isFlagEnabledRaw(raw: string | null): boolean {
  return raw === '1' || raw === 'true'
}

let worldDebugHUDMigrationApplied = false

export function migrateWorldDebugHUDFlag(): void {
  if (worldDebugHUDMigrationApplied) return
  worldDebugHUDMigrationApplied = true

  const storage = globalThis.localStorage
  if (!storage) return

  const hasNewFlagEnabled = isFlagEnabledRaw(readFlagRaw(WORLD_DEBUG_HUD_KEY))
  const hasLegacyFlagEnabled = LEGACY_WORLD_DEBUG_HUD_KEYS.some((key) => isFlagEnabledRaw(readFlagRaw(key)))

  if (!hasNewFlagEnabled && hasLegacyFlagEnabled) {
    storage.setItem(WORLD_DEBUG_HUD_KEY, '1')
  }

  LEGACY_WORLD_DEBUG_HUD_KEYS.forEach((key) => storage.removeItem(key))
}

export function isWorldDebugHUDEnabledInDev(): boolean {
  if (!import.meta.env.DEV) return false
  migrateWorldDebugHUDFlag()
  return isFlagEnabledRaw(readFlagRaw(WORLD_DEBUG_HUD_KEY))
}

export function readWorldDebugHUDFlag(): boolean {
  migrateWorldDebugHUDFlag()
  return isFlagEnabledRaw(readFlagRaw(WORLD_DEBUG_HUD_KEY))
}

export function getWorldDebugHUDStorageKey(): string {
  return WORLD_DEBUG_HUD_KEY
}
