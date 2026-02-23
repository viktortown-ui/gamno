export function resolveWorldDebugHUDPersistValue(input: { developerMode: boolean; worldDebugHUD: boolean }): '0' | '1' {
  return input.developerMode && input.worldDebugHUD ? '1' : '0'
}
