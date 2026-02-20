import { assessCollapseRisk } from '../../collapse/model'
import { computeIndexDay } from '../analytics/compute'
import { METRICS, type MetricId } from '../../metrics'
import type { CheckinRecord, CheckinValues } from '../../models/checkin'
import { regimeFromDay } from '../../regime/model'
import type { InfluenceMatrix } from '../influence/types'
import type { BlackSwanInput, BlackSwanResult, BlackSwanScenarioSpec } from './types'

const DAY_MS = 24 * 60 * 60 * 1000

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function normal(rand: () => number): number {
  const u1 = Math.max(rand(), Number.EPSILON)
  const u2 = rand()
  return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

function clampMetric(metricId: MetricId, value: number): number {
  const m = METRICS.find((metric) => metric.id === metricId)
  if (!m) return value
  return Math.max(m.min, Math.min(m.max, Number(value.toFixed(m.step < 1 ? 2 : 0))))
}

export function buildDailySeries(checkins: CheckinRecord[]): CheckinRecord[] {
  const sorted = [...checkins].sort((a, b) => a.ts - b.ts)
  if (!sorted.length) return []
  const start = Math.floor(sorted[0].ts / DAY_MS) * DAY_MS
  const end = Math.floor(sorted[sorted.length - 1].ts / DAY_MS) * DAY_MS
  let pointer = 0
  let carry = sorted[0]
  const output: CheckinRecord[] = []
  for (let ts = start; ts <= end; ts += DAY_MS) {
    while (pointer < sorted.length && Math.floor(sorted[pointer].ts / DAY_MS) * DAY_MS <= ts) {
      carry = sorted[pointer]
      pointer += 1
    }
    output.push({ ...carry, ts })
  }
  return output
}

function quantile(values: number[], q: number): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return sorted[lo]
  const t = pos - lo
  return sorted[lo] * (1 - t) + sorted[hi] * t
}

function applyScenario(day: number, metricId: MetricId, scenario?: BlackSwanScenarioSpec): number {
  if (!scenario) return 0
  return scenario.shocks.reduce((sum, shock) => {
    if (shock.metricId !== metricId) return sum
    const lag = shock.startLagDays ?? 0
    const within = day >= lag && day < lag + shock.durationDays
    if (!within) return sum
    return sum + (shock.mode === 'step' ? (day === lag ? shock.delta : 0) : shock.delta)
  }, 0)
}

function calcLevers(matrix: InfluenceMatrix): MetricId[] {
  const controllable = new Set<MetricId>(['sleepHours', 'stress', 'focus', 'energy', 'mood', 'social', 'productivity', 'health'])
  const scored: Array<{ id: MetricId; score: number }> = []
  for (const src of METRICS.map((m) => m.id)) {
    if (!controllable.has(src)) continue
    const score = METRICS.map((m) => Math.abs(matrix[src]?.[m.id] ?? 0)).reduce((a, b) => a + b, 0)
    scored.push({ id: src, score })
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, 3).map((x) => x.id)
}

export function runBlackSwan(input: BlackSwanInput, hooks?: { onProgress?: (done: number, total: number) => void; shouldCancel?: () => boolean }): BlackSwanResult {
  const denseHistory = buildDailySeries(input.history)
  const base = input.baseRecord
  const lag = input.learnedLag ?? 1
  const sims = input.settings.simulations
  const horizon = input.settings.horizonDays
  const endIndexValues: number[] = []
  const endCollapseValues: number[] = []
  const everRed: boolean[] = []
  const thresholdEnd: boolean[] = []
  const thresholdEver: boolean[] = []
  const dayIndex: number[][] = Array.from({ length: horizon }, () => [])
  const dayCollapse: number[][] = Array.from({ length: horizon }, () => [])
  const tailMetrics: Record<MetricId, number[]> = METRICS.reduce((acc, m) => ({ ...acc, [m.id]: [] }), {} as Record<MetricId, number[]>)
  const midMetrics: Record<MetricId, number[]> = METRICS.reduce((acc, m) => ({ ...acc, [m.id]: [] }), {} as Record<MetricId, number[]>)

  for (let sim = 0; sim < sims; sim += 1) {
    if (hooks?.shouldCancel?.()) break
    const rand = mulberry32(input.seed + sim * 17)
    let cur: CheckinValues = { ...base }
    const historyBuffer: CheckinValues[] = Array.from({ length: lag }, () => ({ ...base }))
    let hadRed = false
    let hadThreshold = false

    for (let day = 0; day < horizon; day += 1) {
      const next = { ...cur }
      for (const metric of METRICS) {
        const shock = applyScenario(day, metric.id, input.scenario)
        const influence = METRICS.reduce((sum, src) => {
          const srcVal = historyBuffer[(historyBuffer.length - 1 + (1 - lag) + lag) % lag][src.id]
          return sum + (input.matrix[src.id]?.[metric.id] ?? 0) * ((srcVal - src.defaultValue) / 10)
        }, 0)
        const sigma = metric.id === 'cashFlow' ? 2500 : 0.4
        const noise = normal(rand) * sigma * input.settings.noiseMultiplier
        next[metric.id] = clampMetric(metric.id, next[metric.id] + shock + influence + noise)
      }

      historyBuffer.push({ ...next })
      if (historyBuffer.length > lag) historyBuffer.shift()
      cur = next

      const synthetic: CheckinRecord = { ...cur, ts: base.ts + (day + 1) * DAY_MS }
      const index = computeIndexDay(synthetic)
      const collapse = assessCollapseRisk({ ts: synthetic.ts, index, risk: synthetic.stress * 10, volatility: input.settings.noiseMultiplier, xp: 0, level: 1, entropy: 0, drift: 0, stats: { strength: index * 10, intelligence: index * 10, wisdom: index * 10, dexterity: index * 10 } }, synthetic)
      const regime = regimeFromDay({ dayIndex: index * 10, stress: synthetic.stress, sleepHours: synthetic.sleepHours, energy: synthetic.energy, mood: synthetic.mood, volatility: input.settings.noiseMultiplier * 40 })
      const red = collapse.sirenLevel === 'red' || regime === 4
      if (red) hadRed = true
      if (collapse.pCollapse >= input.settings.thresholdCollapse) hadThreshold = true

      dayIndex[day].push(index)
      dayCollapse[day].push(collapse.pCollapse)
      if (day === horizon - 1) {
        endIndexValues.push(index)
        endCollapseValues.push(collapse.pCollapse)
        for (const m of METRICS) {
          if (hadRed) tailMetrics[m.id].push(synthetic[m.id])
          else midMetrics[m.id].push(synthetic[m.id])
        }
      }
    }

    everRed.push(hadRed)
    thresholdEver.push(hadThreshold)
    thresholdEnd.push((endCollapseValues.at(-1) ?? 0) >= input.settings.thresholdCollapse)
    hooks?.onProgress?.(sim + 1, sims)
  }

  const p10Index = dayIndex.map((values) => Number(quantile(values, 0.1).toFixed(3)))
  const p50Index = dayIndex.map((values) => Number(quantile(values, 0.5).toFixed(3)))
  const p90Index = dayIndex.map((values) => Number(quantile(values, 0.9).toFixed(3)))
  const p10Collapse = dayCollapse.map((values) => Number(quantile(values, 0.1).toFixed(4)))
  const p50Collapse = dayCollapse.map((values) => Number(quantile(values, 0.5).toFixed(4)))
  const p90Collapse = dayCollapse.map((values) => Number(quantile(values, 0.9).toFixed(4)))

  const alpha = input.settings.alpha
  const esCoreIndex = Number((endIndexValues.sort((a, b) => a - b).slice(0, Math.max(1, Math.floor(endIndexValues.length * alpha))).reduce((s, v) => s + v, 0) / Math.max(1, Math.floor(endIndexValues.length * alpha))).toFixed(4))
  const esCollapse = Number((endCollapseValues.sort((a, b) => b - a).slice(0, Math.max(1, Math.floor(endCollapseValues.length * alpha))).reduce((s, v) => s + v, 0) / Math.max(1, Math.floor(endCollapseValues.length * alpha))).toFixed(4))

  const drivers = METRICS
    .map((m) => {
      const tailMean = tailMetrics[m.id].reduce((sum, value) => sum + value, 0) / Math.max(1, tailMetrics[m.id].length)
      const midMean = midMetrics[m.id].reduce((sum, value) => sum + value, 0) / Math.max(1, midMetrics[m.id].length)
      return { metricId: m.id, labelRu: m.labelRu, delta: Number((tailMean - midMean).toFixed(3)) }
    })
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 3)

  const bins = 12
  const hist = Array.from({ length: bins }, (_, idx) => ({ bucket: `${(idx / bins).toFixed(2)}-${((idx + 1) / bins).toFixed(2)}`, value: 0 }))
  for (const value of endCollapseValues) {
    const idx = Math.min(bins - 1, Math.max(0, Math.floor(value * bins)))
    hist[idx].value += 1
  }

  const recommendations = calcLevers(input.matrix).map((metricId, idx) => {
    const delta = metricId === 'stress' ? -0.6 - idx * 0.1 : 0.6 + idx * 0.1
    const weightPower = METRICS.reduce((sum, m) => sum + Math.abs(input.matrix[metricId]?.[m.id] ?? 0), 0)
    const indexShift = delta * weightPower * 0.9
    const collapseShift = -Math.sign(delta) * weightPower * 0.015
    return {
      metricId,
      actionRu: `${delta > 0 ? 'Поднять' : 'Снизить'} «${METRICS.find((m) => m.id === metricId)?.labelRu ?? metricId}» на ${Math.abs(delta).toFixed(1)} в день`,
      delta,
      effectIndex: { p10: Number((indexShift * 0.6).toFixed(2)), p50: Number(indexShift.toFixed(2)), p90: Number((indexShift * 1.35).toFixed(2)) },
      effectCollapse: { p10: Number((collapseShift * 0.6).toFixed(3)), p50: Number(collapseShift.toFixed(3)), p90: Number((collapseShift * 1.35).toFixed(3)) },
    }
  })

  const probEverRed = everRed.filter(Boolean).length / Math.max(1, everRed.length)
  const esBadge: 'green' | 'amber' | 'red' = esCollapse >= 0.35 ? 'red' : esCollapse >= 0.2 ? 'amber' : 'green'

  return {
    generatedAt: Date.now(),
    horizonDays: horizon,
    simulations: sims,
    seed: input.seed,
    coreIndex: { p10: p10Index, p50: p50Index, p90: p90Index },
    pCollapse: { p10: p10Collapse, p50: p50Collapse, p90: p90Collapse },
    days: Array.from({ length: horizon }, (_, idx) => idx + 1),
    histogram: hist,
    tail: {
      probEverRed: Number(probEverRed.toFixed(4)),
      probThresholdEnd: Number((thresholdEnd.filter(Boolean).length / Math.max(1, thresholdEnd.length)).toFixed(4)),
      probThresholdEver: Number((thresholdEver.filter(Boolean).length / Math.max(1, thresholdEver.length)).toFixed(4)),
      esCoreIndex,
      esCollapse,
    },
    topDrivers: drivers,
    recommendations,
    noteRu: `Это вероятностная модель, а не доказательство причинности. Dense history: ${denseHistory.length} дней.`,
    summary: { pRed7d: Number(probEverRed.toFixed(4)), esCollapse10: esCollapse, sirenLevel: esBadge },
  }
}
