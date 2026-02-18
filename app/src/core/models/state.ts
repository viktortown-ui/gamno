import type { CoreStats } from '../engines/stateEngine'

export interface StateSnapshotRecord {
  id?: number
  ts: number
  index: number
  risk: number
  volatility: number
  xp: number
  level: number
  entropy: number
  drift: number
  stats: CoreStats
}
