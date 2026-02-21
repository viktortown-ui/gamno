export type TailRiskMethod = 'linear-interpolated'


export interface TailRiskSummaryCompact {
  alpha: number
  var: number
  es: number
  tailMass: number
  n: number
  method: TailRiskMethod
  warnings: string[]
}

export function compactTailRiskSummary(summary: TailRiskSummary): TailRiskSummaryCompact {
  return {
    alpha: Number(summary.alpha.toFixed(6)),
    var: Number(summary.var.toFixed(6)),
    es: Number(summary.es.toFixed(6)),
    tailMass: Number(summary.tailMass.toFixed(6)),
    n: summary.n,
    method: summary.method,
    warnings: [...summary.warnings],
  }
}

export interface TailRiskSummary {
  alpha: number
  var: number
  es: number
  tailMean: number
  tailMass: number
  n: number
  method: TailRiskMethod
  warnings: string[]
}

function sanitizeAlpha(alpha: number, warnings: string[]): number {
  if (!Number.isFinite(alpha)) {
    warnings.push('alpha-not-finite')
    return 0.975
  }
  if (alpha < 0.5) {
    warnings.push('alpha-clamped-low')
    return 0.5
  }
  if (alpha > 0.9999) {
    warnings.push('alpha-clamped-high')
    return 0.9999
  }
  return alpha
}

function deterministicSorted(values: number[]): number[] {
  return values
    .map((value, index) => ({ value, index }))
    .sort((a, b) => (a.value - b.value) || (a.index - b.index))
    .map((entry) => entry.value)
}

function linearQuantile(sortedValues: number[], q: number): number {
  if (!sortedValues.length) return 0
  const position = (sortedValues.length - 1) * q
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  const lowerValue = sortedValues[lower] ?? sortedValues[sortedValues.length - 1] ?? 0
  const upperValue = sortedValues[upper] ?? lowerValue
  if (lower === upper) return lowerValue
  const weight = position - lower
  return lowerValue + (upperValue - lowerValue) * weight
}

export function computeTailRisk(samples: number[], alpha = 0.975): TailRiskSummary {
  const warnings: string[] = []
  const finiteSamples = samples.filter((value) => Number.isFinite(value))
  if (finiteSamples.length !== samples.length) warnings.push('dropped-non-finite')
  const safeAlpha = sanitizeAlpha(alpha, warnings)

  if (!finiteSamples.length) {
    warnings.push('empty-sample')
    return {
      alpha: safeAlpha,
      var: 0,
      es: 0,
      tailMean: 0,
      tailMass: 0,
      n: 0,
      method: 'linear-interpolated',
      warnings,
    }
  }

  const sorted = deterministicSorted(finiteSamples)
  const varValue = linearQuantile(sorted, safeAlpha)
  const tail = sorted.filter((value) => value >= varValue)
  const tailMass = tail.length / sorted.length
  if (tail.length === 1) warnings.push('single-tail-point')

  const tailMean = tail.reduce((sum, value) => sum + value, 0) / Math.max(tail.length, 1)
  return {
    alpha: safeAlpha,
    var: varValue,
    es: tailMean,
    tailMean,
    tailMass,
    n: sorted.length,
    method: 'linear-interpolated',
    warnings,
  }
}
