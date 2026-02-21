import type { ReliabilityBinSummary } from '../../core/engines/analytics/modelHealth'

const SVG_WIDTH = 210
const SVG_HEIGHT = 100
const SVG_PAD = 10

export function getBinPointsPath(bins: ReliabilityBinSummary[]): string {
  if (!bins.length) return ''
  const sortedBins = [...bins].sort((left, right) => left.index - right.index)
  const innerWidth = SVG_WIDTH - SVG_PAD * 2
  const innerHeight = SVG_HEIGHT - SVG_PAD * 2
  return sortedBins
    .map((bin, index) => {
      const x = SVG_PAD + ((bin.index + 0.5) / sortedBins.length) * innerWidth
      const y = SVG_HEIGHT - SVG_PAD - Math.max(0, Math.min(1, bin.observedRate)) * innerHeight
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
    })
    .join(' ')
}

export function getIdealPath(binCount: number): string {
  if (binCount <= 0) return ''
  const innerWidth = SVG_WIDTH - SVG_PAD * 2
  const startX = SVG_PAD + (0.5 / binCount) * innerWidth
  const startY = SVG_HEIGHT - SVG_PAD
  const endX = SVG_PAD + ((binCount - 0.5) / binCount) * innerWidth
  const endY = SVG_PAD
  return `M ${startX.toFixed(2)} ${startY.toFixed(2)} L ${endX.toFixed(2)} ${endY.toFixed(2)}`
}
