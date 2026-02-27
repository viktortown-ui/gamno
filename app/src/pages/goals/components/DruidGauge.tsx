type GaugeStateKind = 'good' | 'warn' | 'bad' | 'na'

type DruidGaugeProps = {
  label: string
  value01?: number | null
  stateLabel: string
  stateKind: GaugeStateKind
}

const START_ANGLE = 210
const END_ANGLE = -30
const ARC_SPAN = START_ANGLE - END_ANGLE
const CENTER_X = 80
const CENTER_Y = 88
const RADIUS = 56

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function toCartesian(cx: number, cy: number, radius: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180
  return {
    x: cx + radius * Math.cos(rad),
    y: cy - radius * Math.sin(rad),
  }
}

function describeArc(startAngle: number, endAngle: number) {
  const start = toCartesian(CENTER_X, CENTER_Y, RADIUS, startAngle)
  const end = toCartesian(CENTER_X, CENTER_Y, RADIUS, endAngle)
  const angleDelta = Math.abs(endAngle - startAngle)
  const largeArcFlag = angleDelta > 180 ? 1 : 0
  return `M ${start.x} ${start.y} A ${RADIUS} ${RADIUS} 0 ${largeArcFlag} 1 ${end.x} ${end.y}`
}

function resolveNeedleValue(value01?: number | null, stateKind?: GaugeStateKind): number {
  if (typeof value01 === 'number') {
    return clamp01(value01)
  }

  if (stateKind === 'good') return 0.75
  if (stateKind === 'warn') return 0.5
  if (stateKind === 'bad') return 0.2
  return 0.5
}

export function DruidGauge({ label, value01, stateLabel, stateKind }: DruidGaugeProps) {
  const needleValue = resolveNeedleValue(value01, stateKind)
  const angle = START_ANGLE - needleValue * ARC_SPAN
  const tip = toCartesian(CENTER_X, CENTER_Y, RADIUS - 6, angle)

  const sectorClassByIndex = ['druid-gauge__sector--bad', 'druid-gauge__sector--warn', 'druid-gauge__sector--good']
  const stateClass = `status-badge ${
    stateKind === 'good'
      ? 'status-badge--low'
      : stateKind === 'warn'
        ? 'status-badge--mid'
        : stateKind === 'bad'
          ? 'status-badge--high'
          : 'status-badge--na'
  }`

  return (
    <div className={`druid-gauge druid-gauge--${stateKind}`} aria-label={`${label}: ${stateLabel}`}>
      <svg className="druid-gauge__svg" viewBox="0 0 160 110" role="img" aria-hidden="true" focusable="false">
        <path className="druid-gauge__track" d={describeArc(START_ANGLE, END_ANGLE)} />
        {[0, 1, 2].map((index) => {
          const segmentSize = ARC_SPAN / 3
          const segmentStart = START_ANGLE - segmentSize * index
          const segmentEnd = START_ANGLE - segmentSize * (index + 1)
          return <path key={index} className={`druid-gauge__sector ${sectorClassByIndex[index]}`} d={describeArc(segmentStart, segmentEnd)} />
        })}

        <line
          className="druid-gauge__needle"
          x1={CENTER_X}
          y1={CENTER_Y}
          x2={tip.x}
          y2={tip.y}
        />
        <circle className="druid-gauge__hub" cx={CENTER_X} cy={CENTER_Y} r={5} />
      </svg>

      <div className="druid-gauge__meta">
        <span>{label}</span>
        <strong className={stateClass}>{stateLabel}</strong>
      </div>
    </div>
  )
}
