interface RuneDialProps {
  label: string
  level: number
  stateLabel: string
  onChange: (level: number) => void
}

const startAngle = -210
const totalSweep = 240
const segments = 6

function polarToCartesian(cx: number, cy: number, radius: number, angleDeg: number) {
  const radians = (angleDeg * Math.PI) / 180
  return { x: cx + radius * Math.cos(radians), y: cy + radius * Math.sin(radians) }
}

function describeArc(cx: number, cy: number, radius: number, angleA: number, angleB: number) {
  const start = polarToCartesian(cx, cy, radius, angleA)
  const end = polarToCartesian(cx, cy, radius, angleB)
  const largeArcFlag = Math.abs(angleB - angleA) > 180 ? 1 : 0
  return `M ${start.x.toFixed(3)} ${start.y.toFixed(3)} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x.toFixed(3)} ${end.y.toFixed(3)}`
}

export function RuneDial({ label, level, stateLabel, onChange }: RuneDialProps) {
  const needleAngle = startAngle + (Math.max(0, Math.min(5, level)) / 5) * totalSweep

  return (
    <article className="rune-dial">
      <h4>{label}</h4>
      <svg viewBox="0 0 180 150" aria-label={`${label}: ${stateLabel}`}>
        <circle className="rune-dial__halo" cx="90" cy="80" r="52" />
        {Array.from({ length: segments }).map((_, index) => {
          const angleA = startAngle + (index / segments) * totalSweep
          const angleB = startAngle + ((index + 1) / segments) * totalSweep
          const active = index <= level
          return (
            <g key={`${label}-${index}`}>
              <path className={active ? 'rune-dial__arc rune-dial__arc--active' : 'rune-dial__arc'} d={describeArc(90, 80, 56, angleA, angleB)} />
              <path
                className="rune-dial__hit"
                d={describeArc(90, 80, 66, angleA, angleB)}
                onClick={() => onChange(index)}
              />
            </g>
          )
        })}
        <line
          className="rune-dial__needle"
          x1="90"
          y1="80"
          x2={polarToCartesian(90, 80, 42, needleAngle).x}
          y2={polarToCartesian(90, 80, 42, needleAngle).y}
        />
        <circle className="rune-dial__hub" cx="90" cy="80" r="7" />
      </svg>
      <p>{stateLabel}</p>
    </article>
  )
}
