/// <reference lib="webworker" />

import { runWorldMapWorkerEntry, type WorldMapWorkerInput } from './worldMap.worker.entry'

self.onmessage = (event: MessageEvent<{ type: 'build'; input: WorldMapWorkerInput }>) => {
  try {
    const result = runWorldMapWorkerEntry(event.data.input)
    self.postMessage({ type: 'done', result })
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : 'Ошибка построения карты мира',
    })
  }
}

export {}
