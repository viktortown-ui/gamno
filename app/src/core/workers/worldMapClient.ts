import type { FrameSnapshot } from '../frame/frameEngine'
import type { WorldMapSnapshot, WorldMapViewport } from '../worldMap/types'

export type WorldMapWorkerMessage =
  | { type: 'done'; result: WorldMapSnapshot }
  | { type: 'error'; message: string }

export function createWorldMapWorker(onMessage: (msg: WorldMapWorkerMessage) => void): Worker {
  const worker = new Worker(new URL('../../workers/worldMap.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent<WorldMapWorkerMessage>) => onMessage(event.data)
  return worker
}

export function runWorldMapInWorker(worker: Worker, input: { frame: FrameSnapshot; seed: number; viewport: WorldMapViewport }): void {
  worker.postMessage({ type: 'build', input })
}
