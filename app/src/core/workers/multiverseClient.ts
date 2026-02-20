import type { MultiverseConfig, MultiverseRunResult } from '../engines/multiverse/types'

export type MultiverseWorkerMessage =
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; result: MultiverseRunResult }
  | { type: 'cancelled' }
  | { type: 'error'; message: string }

export function createMultiverseWorker(onMessage: (msg: MultiverseWorkerMessage) => void): Worker {
  const worker = new Worker(new URL('./multiverse.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent<MultiverseWorkerMessage>) => onMessage(event.data)
  return worker
}

export function runMultiverseInWorker(worker: Worker, config: MultiverseConfig): void {
  worker.postMessage({ type: 'run', config })
}

export function cancelMultiverseWorker(worker: Worker): void {
  worker.postMessage({ type: 'cancel' })
}
