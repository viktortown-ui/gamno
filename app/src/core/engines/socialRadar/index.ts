import type { CheckinRecord, CheckinValues } from '../../models/checkin'
import type { PersonRecord, SocialEventRecord, SocialInfluence, SocialRadarResult } from '../../models/socialRadar'
import { dayKeyFromTs, createDenseDayKeys } from '../../utils/dayKey'

const TARGETS: Array<keyof CheckinValues> = ['stress', 'energy', 'mood']

function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0
}

function std(values: number[]): number {
  const mu = mean(values)
  const variance = mean(values.map((value) => (value - mu) ** 2))
  return Math.sqrt(variance)
}

function correlation(xs: number[], ys: number[]): number {
  if (!xs.length || xs.length !== ys.length) return 0
  const mx = mean(xs)
  const my = mean(ys)
  let num = 0
  let dx = 0
  let dy = 0
  for (let i = 0; i < xs.length; i += 1) {
    const xv = xs[i] - mx
    const yv = ys[i] - my
    num += xv * yv
    dx += xv * xv
    dy += yv * yv
  }
  if (!dx || !dy) return 0
  return num / Math.sqrt(dx * dy)
}

function confidence(stability: number, strength: number): 'high' | 'med' | 'low' {
  if (stability >= 0.66 && strength >= 0.2) return 'high'
  if (stability >= 0.45 && strength >= 0.12) return 'med'
  return 'low'
}

function buildSeries(
  checkins: CheckinRecord[],
  events: SocialEventRecord[],
  people: PersonRecord[],
  windowDays: number,
): {
  days: string[]
  targets: Record<string, number[]>
  features: Record<string, number[]>
} {
  const byDay = new Map<string, CheckinRecord>()
  const ascCheckins = [...checkins].sort((a, b) => a.ts - b.ts)
  for (const row of ascCheckins) byDay.set(dayKeyFromTs(row.ts), row)
  const allDayKeys = [...byDay.keys(), ...events.map((event) => event.dayKey)].sort()
  if (!allDayKeys.length) return { days: [], targets: {}, features: {} }
  const end = allDayKeys.at(-1) as string
  const endTs = Date.parse(`${end}T00:00:00.000Z`)
  const startTs = endTs - (windowDays - 1) * 24 * 60 * 60 * 1000
  const start = dayKeyFromTs(startTs)
  const days = createDenseDayKeys(start, end)

  const targets: Record<string, number[]> = {}
  for (const target of TARGETS) targets[target] = []
  targets.index = []

  let last: CheckinRecord | undefined
  for (const day of days) {
    const item = byDay.get(day)
    if (item) last = item
    if (last) {
      for (const target of TARGETS) targets[target].push(last[target])
      targets.index.push((last.energy + last.focus + last.mood + last.social + last.health + last.productivity + (10 - last.stress) + Math.min(last.sleepHours, 10)) / 8)
    } else {
      for (const target of TARGETS) targets[target].push(0)
      targets.index.push(0)
    }
  }

  const dayEvents = new Map<string, SocialEventRecord[]>()
  for (const event of events) {
    const current = dayEvents.get(event.dayKey) ?? []
    current.push(event)
    dayEvents.set(event.dayKey, current)
  }

  const personMap = new Map<number, string>()
  for (const person of people) {
    if (person.id) personMap.set(person.id, person.nameAlias)
  }

  const featureKeys = new Set<string>()
  for (const event of events) {
    featureKeys.add(`type:${event.type}:impact`)
    featureKeys.add(`type:${event.type}:freq`)
    if (event.personId && personMap.has(event.personId)) {
      featureKeys.add(`person:${personMap.get(event.personId) as string}:impact`)
      featureKeys.add(`person:${personMap.get(event.personId) as string}:freq`)
    }
  }

  const features: Record<string, number[]> = {}
  for (const key of featureKeys) features[key] = []

  for (const day of days) {
    const list = dayEvents.get(day) ?? []
    const buckets = new Map<string, number>()
    for (const event of list) {
      const impact = event.intensity * event.valence
      buckets.set(`type:${event.type}:impact`, (buckets.get(`type:${event.type}:impact`) ?? 0) + impact)
      buckets.set(`type:${event.type}:freq`, (buckets.get(`type:${event.type}:freq`) ?? 0) + 1)
      if (event.personId && personMap.has(event.personId)) {
        const personName = personMap.get(event.personId) as string
        buckets.set(`person:${personName}:impact`, (buckets.get(`person:${personName}:impact`) ?? 0) + impact)
        buckets.set(`person:${personName}:freq`, (buckets.get(`person:${personName}:freq`) ?? 0) + 1)
      }
    }

    for (const key of featureKeys) {
      features[key].push(buckets.get(key) ?? 0)
    }
  }

  return { days, targets, features }
}

function rollingStability(feature: number[], target: number[], lag: number): { strength: number; stability: number; sign: 1 | -1 } {
  const windows = 3
  const span = Math.max(10, Math.floor(target.length / windows))
  const signs: number[] = []
  const strengths: number[] = []

  for (let w = 0; w < windows; w += 1) {
    const end = target.length - (windows - w - 1) * Math.floor(span / 2)
    const start = Math.max(0, end - span)
    const xs: number[] = []
    const ys: number[] = []
    for (let i = start + lag; i < end; i += 1) {
      xs.push(feature[i - lag])
      ys.push(target[i])
    }
    if (xs.length < 6 || std(xs) === 0 || std(ys) === 0) continue
    const c = correlation(xs, ys)
    signs.push(Math.sign(c))
    strengths.push(Math.abs(c))
  }

  if (!strengths.length) return { strength: 0, stability: 0, sign: 1 }
  const positive = signs.filter((item) => item >= 0).length
  const negative = signs.length - positive
  const sign: 1 | -1 = positive >= negative ? 1 : -1
  const signAligned = signs.filter((item) => item === sign).length / signs.length
  return {
    sign,
    strength: mean(strengths),
    stability: signAligned,
  }
}

function toInfluence(featureKey: string, lagScores: Array<{ lag: number; value: number; stability: number; sign: 1 | -1 }>): SocialInfluence | null {
  const strongest = [...lagScores].sort((a, b) => Math.abs(b.value) - Math.abs(a.value))[0]
  if (!strongest || Math.abs(strongest.value) < 0.09) return null
  const [sourceType, sourceName] = featureKey.split(':')
  const normalizedType = sourceType === 'person' ? 'person' : 'eventType'
  const key = normalizedType === 'person' ? `Контакт: ${sourceName}` : `Событие: ${sourceName}`
  const sign: 'positive' | 'negative' = strongest.sign > 0 ? 'positive' : 'negative'
  const strength = Number(Math.abs(strongest.value).toFixed(3))
  const stability = Number(strongest.stability.toFixed(3))

  const evidence = lagScores
    .filter((item) => Math.abs(item.value) >= Math.max(0.06, strength * 0.5))
    .slice(0, 3)
    .map((item) => `${key}: лаг ${item.lag} дн., эффект ${item.value > 0 ? '+' : ''}${item.value.toFixed(2)}`)

  return {
    key,
    sourceType: normalizedType,
    lag: strongest.lag,
    sign,
    strength,
    stability,
    confidence: confidence(stability, strength),
    effectByLag: lagScores.map((item) => ({ lag: item.lag, value: Number(item.value.toFixed(3)) })),
    evidence,
  }
}

export function computeSocialRadar(
  checkins: CheckinRecord[],
  events: SocialEventRecord[],
  people: PersonRecord[],
  opts: { windowDays?: number; maxLag?: number } = {},
): SocialRadarResult {
  const windowDays = opts.windowDays ?? 56
  const maxLag = opts.maxLag ?? 7
  const prepared = buildSeries(checkins, events, people, windowDays)

  const influencesByMetric: Record<string, SocialInfluence[]> = {
    stress: [],
    energy: [],
    mood: [],
    index: [],
  }

  for (const [metricId, target] of Object.entries(prepared.targets)) {
    if (target.length < 14) continue
    const metricInfluences: SocialInfluence[] = []
    for (const [featureKey, featureSeries] of Object.entries(prepared.features)) {
      const lagScores = [] as Array<{ lag: number; value: number; stability: number; sign: 1 | -1 }>
      for (let lag = 0; lag <= maxLag; lag += 1) {
        const { strength, stability, sign } = rollingStability(featureSeries, target, lag)
        lagScores.push({ lag, value: sign * strength, stability, sign })
      }
      const influence = toInfluence(featureKey, lagScores)
      if (influence) metricInfluences.push(influence)
    }

    influencesByMetric[metricId] = metricInfluences
      .sort((a, b) => b.strength - a.strength)
      .slice(0, 20)
  }

  return {
    computedAt: Date.now(),
    windowDays,
    maxLag,
    disclaimerRu: 'Показана предиктивная связь, не доказательство причинности.',
    influencesByMetric,
  }
}
