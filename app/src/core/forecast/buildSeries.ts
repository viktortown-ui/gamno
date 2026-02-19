import { computeIndexDay } from '../engines/analytics/compute'
import type { CheckinRecord } from '../models/checkin'
import type { StateSnapshotRecord } from '../models/state'

export type ForecastSeriesKey = 'index' | 'risk' | 'volatility' | 'entropy' | 'strength' | 'intelligence' | 'wisdom'

export interface DailySeries {
  key: ForecastSeriesKey
  dates: string[]
  values: number[]
}

const DAY_MS = 24 * 60 * 60 * 1000

function toDayTs(ts: number): number {
  const date = new Date(ts)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

function isoDay(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10)
}

function createDenseDays(start: number, end: number): number[] {
  const days: number[] = []
  for (let ts = start; ts <= end; ts += DAY_MS) {
    days.push(ts)
  }
  return days
}

export function buildDailySeries(
  snapshots: StateSnapshotRecord[],
  checkins: CheckinRecord[],
  key: ForecastSeriesKey,
): DailySeries {
  const snapshotMap = new Map<number, StateSnapshotRecord>()
  for (const snapshot of snapshots) {
    snapshotMap.set(toDayTs(snapshot.ts), snapshot)
  }

  const checkinMap = new Map<number, CheckinRecord>()
  for (const checkin of checkins) {
    checkinMap.set(toDayTs(checkin.ts), checkin)
  }

  const dayKeys = [...snapshotMap.keys(), ...checkinMap.keys()].sort((a, b) => a - b)
  if (!dayKeys.length) {
    return { key, dates: [], values: [] }
  }

  const denseDays = createDenseDays(dayKeys[0], dayKeys[dayKeys.length - 1])
  const values: number[] = []
  let carry = 0

  for (const dayTs of denseDays) {
    const snapshot = snapshotMap.get(dayTs)
    const checkin = checkinMap.get(dayTs)
    let value: number | undefined

    if (snapshot) {
      switch (key) {
        case 'index':
          value = snapshot.index
          break
        case 'risk':
          value = snapshot.risk
          break
        case 'volatility':
          value = snapshot.volatility
          break
        case 'entropy':
          value = snapshot.entropy
          break
        case 'strength':
          value = snapshot.stats.strength
          break
        case 'intelligence':
          value = snapshot.stats.intelligence
          break
        case 'wisdom':
          value = snapshot.stats.wisdom
          break
      }
    }

    if (value === undefined && key === 'index' && checkin) {
      value = computeIndexDay(checkin)
    }

    if (value !== undefined) {
      carry = Number(value.toFixed(2))
    }
    values.push(carry)
  }

  return {
    key,
    dates: denseDays.map(isoDay),
    values,
  }
}

export function buildForecastInput(
  snapshots: StateSnapshotRecord[],
  checkins: CheckinRecord[],
  keys: ForecastSeriesKey[],
): Record<ForecastSeriesKey, DailySeries> {
  const result = {} as Record<ForecastSeriesKey, DailySeries>
  for (const key of keys) {
    result[key] = buildDailySeries(snapshots, checkins, key)
  }
  return result
}
