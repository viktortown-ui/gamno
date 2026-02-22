export type AAMode = 'fxaa' | 'msaa'

export function resolveAAMode(forceMode: AAMode | null, webgl2Available: boolean): AAMode {
  if (forceMode === 'fxaa') return 'fxaa'
  if (forceMode === 'msaa') return webgl2Available ? 'msaa' : 'fxaa'
  return webgl2Available ? 'msaa' : 'fxaa'
}
