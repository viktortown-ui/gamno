export type ModelHealthKind = 'learned' | 'forecast' | 'policy'
export type ModelHealthGrade = 'green' | 'yellow' | 'red'

export interface CalibrationPoint {
  probability: number
  outcome: 0 | 1
}

export interface ReliabilityBinSummary {
  index: number
  left: number
  right: number
  count: number
  meanProbability: number
  observedRate: number
  gap: number
}

export interface DriftSummary {
  triggered: boolean
  triggerIndex: number | null
  score: number
}

export interface ModelHealthSnapshot {
  v: 1
  kind: ModelHealthKind
  grade: ModelHealthGrade
  reasonsRu: string[]
  data: { samples: number; minSamples: number; sufficient: boolean }
  calibration: { brier: number; worstGap: number; bins: ReliabilityBinSummary[] }
  drift: DriftSummary
}

function clamp01(value: number): number {
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

export function computeBrierScore(points: CalibrationPoint[]): number {
  if (!points.length) return 1
  const total = points.reduce((sum, point) => {
    const p = clamp01(point.probability)
    return sum + (p - point.outcome) ** 2
  }, 0)
  return Number((total / points.length).toFixed(6))
}

export function computeReliabilityBins(points: CalibrationPoint[], bins = 5): ReliabilityBinSummary[] {
  const safeBins = Math.max(1, Math.floor(bins))
  const rows = Array.from({ length: safeBins }, (_, index) => ({
    index,
    left: Number((index / safeBins).toFixed(3)),
    right: Number(((index + 1) / safeBins).toFixed(3)),
    count: 0,
    sumProbability: 0,
    sumOutcome: 0,
  }))

  points.forEach((point) => {
    const p = clamp01(point.probability)
    const index = Math.min(safeBins - 1, Math.floor(p * safeBins))
    const row = rows[index]
    row.count += 1
    row.sumProbability += p
    row.sumOutcome += point.outcome
  })

  return rows.map((row) => {
    const meanProbability = row.count ? row.sumProbability / row.count : 0
    const observedRate = row.count ? row.sumOutcome / row.count : 0
    return {
      index: row.index,
      left: row.left,
      right: row.right,
      count: row.count,
      meanProbability: Number(meanProbability.toFixed(4)),
      observedRate: Number(observedRate.toFixed(4)),
      gap: Number(Math.abs(meanProbability - observedRate).toFixed(4)),
    }
  })
}

export function pageHinkleyDetect(series: number[], params?: { delta?: number; lambda?: number }): DriftSummary {
  const delta = params?.delta ?? 0.01
  const lambda = params?.lambda ?? 0.2
  if (!series.length) return { triggered: false, triggerIndex: null, score: 0 }

  let runningMean = series[0]
  let cumulative = 0
  let minCumulative = 0
  let score = 0

  for (let index = 0; index < series.length; index += 1) {
    const value = series[index]
    runningMean += (value - runningMean) / (index + 1)
    cumulative += value - runningMean - delta
    if (cumulative < minCumulative) minCumulative = cumulative
    score = cumulative - minCumulative
    if (score > lambda) {
      return { triggered: true, triggerIndex: index, score: Number(score.toFixed(4)) }
    }
  }

  return { triggered: false, triggerIndex: null, score: Number(Math.max(0, score).toFixed(4)) }
}

export function evaluateModelHealth(params: {
  kind: ModelHealthKind
  calibration: CalibrationPoint[]
  driftSeries: number[]
  minSamples: number
}): ModelHealthSnapshot {
  const bins = computeReliabilityBins(params.calibration, 5)
  const brier = computeBrierScore(params.calibration)
  const worstGap = Number(Math.max(...bins.map((bin) => bin.gap), 0).toFixed(4))
  const drift = pageHinkleyDetect(params.driftSeries)
  const sampleCount = params.calibration.length
  const sufficient = sampleCount >= params.minSamples

  const reasonsRu: string[] = []
  let grade: ModelHealthGrade = 'green'

  if (!sufficient) {
    reasonsRu.push(`Недостаточно данных: ${sampleCount} из ${params.minSamples}.`)
    grade = 'red'
  } else {
    reasonsRu.push(`Данных достаточно: ${sampleCount}.`)
  }

  if (brier > 0.3 || worstGap > 0.25) {
    grade = 'red'
    reasonsRu.push(`Калибровка слабая: Brier ${brier.toFixed(3)}, разрыв ${worstGap.toFixed(3)}.`)
  } else if (brier > 0.2 || worstGap > 0.15) {
    if (grade !== 'red') grade = 'yellow'
    reasonsRu.push(`Калибровка умеренная: Brier ${brier.toFixed(3)}, разрыв ${worstGap.toFixed(3)}.`)
  } else {
    reasonsRu.push(`Калибровка стабильная: Brier ${brier.toFixed(3)}.`)
  }

  if (drift.triggered) {
    grade = 'red'
    reasonsRu.push(`Обнаружен дрейф распределения (индекс ${drift.triggerIndex}).`)
  } else if (drift.score > 0.1) {
    if (grade === 'green') grade = 'yellow'
    reasonsRu.push('Есть ранние признаки дрейфа.')
  } else {
    reasonsRu.push('Дрейф не обнаружен.')
  }

  return {
    v: 1,
    kind: params.kind,
    grade,
    reasonsRu,
    data: { samples: sampleCount, minSamples: params.minSamples, sufficient },
    calibration: { brier, worstGap, bins },
    drift,
  }
}
