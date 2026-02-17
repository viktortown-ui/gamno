export function Sparkline({ values }: { values: number[] }) {
  if (!values.length) return null
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = Math.max(1, max - min)
  const points = values
    .map((value, i) => `${(i / (values.length - 1 || 1)) * 100},${100 - ((value - min) / range) * 100}`)
    .join(' ')

  return (
    <svg viewBox="0 0 100 100" className="sparkline" aria-hidden="true">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="3" />
    </svg>
  )
}
