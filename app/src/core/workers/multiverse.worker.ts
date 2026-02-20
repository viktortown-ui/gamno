/// <reference lib="webworker" />

import { runMultiverse } from '../engines/multiverse/simulator'
import type { MultiverseConfig } from '../engines/multiverse/types'

let cancelled = false

self.onmessage = (event: MessageEvent<{ type: 'run'; config: MultiverseConfig } | { type: 'cancel' }>) => {
  if (event.data.type === 'cancel') {
    cancelled = true
    return
  }

  cancelled = false
  try {
    const result = runMultiverse(event.data.config, {
      onProgress: (done, total) => self.postMessage({ type: 'progress', done, total }),
      shouldCancel: () => cancelled,
    })
    self.postMessage({ type: cancelled ? 'cancelled' : 'done', result })
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Ошибка симуляции' })
  }
}

export {}
