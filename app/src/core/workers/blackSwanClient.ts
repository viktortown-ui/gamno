import type { BlackSwanInput, BlackSwanResult } from '../engines/blackSwan/types'

export type BlackSwanWorkerMessage =
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; result: BlackSwanResult }
  | { type: 'cancelled' }
  | { type: 'error'; message: string }

export function createBlackSwanWorker(onMessage: (msg: BlackSwanWorkerMessage) => void): Worker {
  const worker = new Worker(new URL('../../workers/blackSwan.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent<BlackSwanWorkerMessage>) => onMessage(event.data)
  return worker
}

export function runBlackSwanInWorker(worker: Worker, input: BlackSwanInput): void {
  worker.postMessage({ type: 'run', input })
}

export function cancelBlackSwanWorker(worker: Worker): void {
  worker.postMessage({ type: 'cancel' })
}
