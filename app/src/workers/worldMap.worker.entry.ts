import type { FrameSnapshot } from '../core/frame/frameEngine'
import { buildWorldMapSnapshot } from '../core/worldMap/buildWorldMapSnapshot'
import type { WorldMapSnapshot, WorldMapViewport } from '../core/worldMap/types'

export interface WorldMapWorkerInput {
  frame: FrameSnapshot
  seed: number
  viewport: WorldMapViewport
}

export function runWorldMapWorkerEntry(input: WorldMapWorkerInput): WorldMapSnapshot {
  return buildWorldMapSnapshot(input.frame, input.seed, input.viewport)
}
