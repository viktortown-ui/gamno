import { INDEX_METRIC_IDS, type MetricId } from '../../metrics'
import type { CheckinRecord } from '../../models/checkin'

const DAY_MS = 24 * 60 * 60 * 1000

export type AverageMap = Partial<Record<MetricId, number>>

export function computeIndexDay(record: CheckinRecord): number {
  const sum = INDEX_METRIC_IDS.reduce((acc, id) => {
    const value = id === 'stress' ? 10 - record[id] : record[id]
    return acc + value
  }, 0)
  return sum / INDEX_METRIC_IDS.length
}

export function computeAverages(records: CheckinRecord[], metricIds: MetricId[], windowDays: number): AverageMap {
  const range = getRange(records, windowDays)
  if (range.length === 0) return {}

  return metricIds.reduce<AverageMap>((acc, metricId) => {
    acc[metricId] = range.reduce((sum, row) => sum + row[metricId], 0) / range.length
    return acc
  }, {})
}

export function computeWindowDelta(
  records: CheckinRecord[],
  metricIds: MetricId[],
  windowDays: number,
): AverageMap {
  const nowTs = Date.now()
  const currentFrom = nowTs - windowDays * DAY_MS
  const previousFrom = nowTs - windowDays * 2 * DAY_MS
  const current = records.filter((row) => row.ts >= currentFrom)
  const previous = records.filter((row) => row.ts >= previousFrom && row.ts < currentFrom)
  const currentAvg = metricIds.reduce<AverageMap>((acc, id) => {
    acc[id] = current.length ? current.reduce((s, item) => s + item[id], 0) / current.length : 0
    return acc
  }, {})

  const previousAvg = metricIds.reduce<AverageMap>((acc, id) => {
    acc[id] = previous.length ? previous.reduce((s, item) => s + item[id], 0) / previous.length : 0
    return acc
  }, {})

  return metricIds.reduce<AverageMap>((acc, id) => {
    acc[id] = (currentAvg[id] ?? 0) - (previousAvg[id] ?? 0)
    return acc
  }, {})
}

export function computeIndexSeries(records: CheckinRecord[]): number[] {
  return [...records].sort((a, b) => a.ts - b.ts).map(computeIndexDay)
}

function localDayKey(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

export function computeStreak(records: CheckinRecord[]): number {
  if (!records.length) return 0
  const uniqueDays = Array.from(new Set(records.map((r) => localDayKey(r.ts))))
    .map((key) => {
      const [y, m, d] = key.split('-').map(Number)
      return new Date(y, m, d).getTime()
    })
    .sort((a, b) => b - a)

  let streak = 1
  for (let i = 1; i < uniqueDays.length; i += 1) {
    if (Math.round((uniqueDays[i - 1] - uniqueDays[i]) / DAY_MS) === 1) streak += 1
    else break
  }
  return streak
}

export function computeTopMovers(deltaMap: AverageMap, count = 3) {
  return Object.entries(deltaMap)
    .map(([metricId, delta]) => ({ metricId: metricId as MetricId, delta: delta ?? 0 }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, count)
}

export function computeVolatility(records: CheckinRecord[], metricId: MetricId, windowDays: number): number {
  const range = getRange(records, windowDays).sort((a, b) => a.ts - b.ts)
  if (range.length < 2) return 0
  const deltas = range.slice(1).map((r, i) => r[metricId] - range[i][metricId])
  const mean = deltas.reduce((s, v) => s + Math.abs(v), 0) / deltas.length
  return mean
}

export function getRange(records: CheckinRecord[], days: number): CheckinRecord[] {
  const from = Date.now() - days * DAY_MS
  return records.filter((r) => r.ts >= from)
}
