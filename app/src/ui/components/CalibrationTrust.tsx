import type { ModelHealthGrade, ModelHealthSnapshot, ReliabilityBinSummary } from '../../core/engines/analytics/modelHealth'
import { getBinPointsPath, getIdealPath } from './CalibrationTrust.utils'

const SVG_WIDTH = 210
const SVG_HEIGHT = 100
const SVG_PAD = 10

function gradeLabelRu(grade: ModelHealthGrade): string {
  if (grade === 'green') return 'Зелёный'
  if (grade === 'yellow') return 'Жёлтый'
  return 'Красный'
}

function getEceValue(bins: ReliabilityBinSummary[]): number {
  const total = bins.reduce((sum, bin) => sum + bin.count, 0)
  if (!total) return 0
  const weighted = bins.reduce((sum, bin) => sum + (bin.count / total) * bin.gap, 0)
  return Number(weighted.toFixed(4))
}

function gradeClass(grade: ModelHealthGrade): string {
  if (grade === 'green') return 'status-badge--low'
  if (grade === 'yellow') return 'status-badge--mid'
  return 'status-badge--high'
}

function brierTrendRu(brier: number): string {
  if (brier <= 0.12) return '↘ Хороший тренд'
  if (brier <= 0.22) return '→ Нейтрально'
  return '↗ Нужна коррекция'
}

export function CalibrationTrustCard({ title, health }: { title: string; health: ModelHealthSnapshot }) {
  const linePath = getBinPointsPath(health.calibration.bins)
  const idealPath = getIdealPath(health.calibration.bins.length)
  const ece = getEceValue(health.calibration.bins)

  return (
    <article className="summary-card panel calibration-card">
      <h3>{title}</h3>
      <p>
        <span className={`status-badge ${gradeClass(health.grade)}`}><strong>{gradeLabelRu(health.grade)}</strong></span>
      </p>
      <ul>
        {health.reasonsRu.map((reason) => <li key={`${health.kind}-${reason}`}>{reason}</li>)}
      </ul>
      <p>
        Brier: <strong>{health.calibration.brier.toFixed(3)}</strong> · {brierTrendRu(health.calibration.brier)} · ECE: <strong>{ece.toFixed(3)}</strong>
      </p>
      <svg width={SVG_WIDTH} height={SVG_HEIGHT} role="img" aria-label={`Надёжность ${title}`}>
        <rect x={SVG_PAD} y={SVG_PAD} width={SVG_WIDTH - SVG_PAD * 2} height={SVG_HEIGHT - SVG_PAD * 2} fill="transparent" stroke="rgba(148,167,203,0.4)" />
        {idealPath ? <path d={idealPath} stroke="rgba(148,167,203,0.55)" strokeDasharray="4 4" fill="none" /> : null}
        {linePath ? <path d={linePath} stroke="rgba(46,233,210,0.95)" strokeWidth="2" fill="none" /> : null}
      </svg>
    </article>
  )
}
