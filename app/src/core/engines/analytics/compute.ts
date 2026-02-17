import { INDEX_METRIC_IDS, type MetricId } from '../../metrics'
import type { AverageMap, CheckinRecord, IndexTrend, MetricDelta } from './types'

const DAY_MS = 24 * 60 * 60 * 1000

export function getRange(records: CheckinRecord[], days: number, nowTs = Date.now()): CheckinRecord[] {
  const fromTs = nowTs - days * DAY_MS
  return records.filter((item) => item.ts >= fromTs)
}

export function computeAverages(records: CheckinRecord[], metricIds: MetricId[]): AverageMap {
  if (records.length === 0) {
    return metricIds.reduce<AverageMap>((acc, id) => ({ ...acc, [id]: 0 }), {})
  }

  return metricIds.reduce<AverageMap>((acc, id) => {
    const sum = records.reduce((total, item) => total + item[id], 0)
    return { ...acc, [id]: sum / records.length }
  }, {})
}

export function computeDelta(currentWindowAvg: AverageMap, prevWindowAvg: AverageMap): AverageMap {
  const allKeys = new Set<MetricId>([
    ...(Object.keys(currentWindowAvg) as MetricId[]),
    ...(Object.keys(prevWindowAvg) as MetricId[]),
  ])

  return Array.from(allKeys).reduce<AverageMap>((acc, key) => {
    acc[key] = (currentWindowAvg[key] ?? 0) - (prevWindowAvg[key] ?? 0)
    return acc
  }, {})
}

export function computeIndexDay(checkin: CheckinRecord): number {
  const sum = INDEX_METRIC_IDS.reduce((total, id) => total + checkin[id], 0)
  return sum / INDEX_METRIC_IDS.length
}

export function computeIndexTrend(records: CheckinRecord[], days = 7, nowTs = Date.now()): IndexTrend {
  const current = getRange(records, days, nowTs)
  const prevFrom = nowTs - days * 2 * DAY_MS
  const currentFrom = nowTs - days * DAY_MS
  const previous = records.filter((item) => item.ts >= prevFrom && item.ts < currentFrom)

  const currentAvg =
    current.length > 0 ? current.reduce((sum, item) => sum + computeIndexDay(item), 0) / current.length : 0
  const previousAvg =
    previous.length > 0 ? previous.reduce((sum, item) => sum + computeIndexDay(item), 0) / previous.length : 0

  const delta = currentAvg - previousAvg

  return {
    currentAvg,
    previousAvg,
    delta,
    direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat',
  }
}

export function computeTopMovers(deltaMap: AverageMap, count = 3): MetricDelta[] {
  return (Object.entries(deltaMap) as [MetricId, number][])
    .map(([metricId, delta]) => ({
      metricId,
      delta,
      direction: (delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat') as 'up' | 'down' | 'flat',
    }))
    .filter((item) => item.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, count)
}

function localDayKey(ts: number): string {
  const date = new Date(ts)
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

export function computeStreak(records: CheckinRecord[]): number {
  if (records.length === 0) return 0

  const uniqueDays = Array.from(new Set(records.map((item) => localDayKey(item.ts))))
    .map((key) => {
      const [year, month, day] = key.split('-').map(Number)
      return new Date(year, month, day).getTime()
    })
    .sort((a, b) => b - a)

  let streak = 1
  for (let i = 1; i < uniqueDays.length; i += 1) {
    const diffDays = Math.round((uniqueDays[i - 1] - uniqueDays[i]) / DAY_MS)
    if (diffDays === 1) streak += 1
    else break
  }

  return streak
}

export function computeVolatility(
  records: CheckinRecord[],
  metricId: MetricId,
  days = 14,
  nowTs = Date.now(),
): number {
  const range = getRange(records, days, nowTs).sort((a, b) => a.ts - b.ts)
  if (range.length < 2) return 0

  const changes = range.slice(1).map((item, idx) => item[metricId] - range[idx][metricId])
  const mean = changes.reduce((sum, value) => sum + value, 0) / changes.length
  const variance = changes.reduce((sum, value) => sum + (value - mean) ** 2, 0) / changes.length
  return Math.sqrt(variance)
}
