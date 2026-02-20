/// <reference lib="webworker" />

import { runBlackSwan } from '../core/engines/blackSwan'
import type { BlackSwanInput } from '../core/engines/blackSwan/types'

let cancelled = false

self.onmessage = (event: MessageEvent<{ type: 'run'; input: BlackSwanInput } | { type: 'cancel' }>) => {
  if (event.data.type === 'cancel') {
    cancelled = true
    return
  }

  cancelled = false
  try {
    const result = runBlackSwan(event.data.input, {
      onProgress: (done, total) => self.postMessage({ type: 'progress', done, total }),
      shouldCancel: () => cancelled,
    })
    self.postMessage({ type: cancelled ? 'cancelled' : 'done', result })
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Ошибка расчёта' })
  }
}

export {}
