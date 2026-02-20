function quantile(values: number[], q: number): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const pos = (sorted.length - 1) * q
  const base = Math.floor(pos)
  const rest = pos - base
  const current = sorted[base] ?? sorted[sorted.length - 1] ?? 0
  const next = sorted[base + 1] ?? current
  return current + (next - current) * rest
}

export function valueAtRisk(losses: number[], alpha: number): number {
  if (!losses.length) return 0
  const safeAlpha = Math.max(0.0001, Math.min(0.9999, alpha))
  return quantile(losses, safeAlpha)
}

export function conditionalVaR(losses: number[], alpha: number): number {
  if (!losses.length) return 0
  const varAlpha = valueAtRisk(losses, alpha)
  const tail = losses.filter((loss) => loss >= varAlpha)
  if (!tail.length) return varAlpha
  return tail.reduce((sum, loss) => sum + loss, 0) / tail.length
}

