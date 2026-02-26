import { METRICS, type MetricId } from '../../core/metrics'

type UnknownRecord = Record<string, unknown>

export interface CanonicalGraphNode {
  id: string
  label: string
}

export interface SanitizedGraphLink {
  source: string
  target: string
}

export interface SanitizedGraphResult<TNode extends { id: string }, TLink extends { source: unknown; target: unknown }> {
  nodes: TNode[]
  links: Array<Omit<TLink, 'source' | 'target'> & SanitizedGraphLink>
  droppedLinksCount: number
  droppedExamples: Array<{ source: unknown; target: unknown }>
}

const metricIdByLabel = METRICS.reduce<Record<string, MetricId>>((acc, metric) => {
  acc[metric.id.toLowerCase()] = metric.id
  acc[metric.labelRu.toLowerCase()] = metric.id
  return acc
}, {})

function defaultResolveId(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  if (!value || typeof value !== 'object') return null
  const candidate = value as UnknownRecord
  const objectId = candidate.id
  if (typeof objectId === 'string' || typeof objectId === 'number') return String(objectId)
  return null
}

export function canonicalMetricId(value: unknown): MetricId | null {
  const raw = defaultResolveId(value)
  if (!raw) return null
  return metricIdByLabel[raw.trim().toLowerCase()] ?? null
}

export function sanitizeGraphData<TNode extends { id: string }, TLink extends { source: unknown; target: unknown }>(
  nodes: TNode[],
  links: TLink[],
  resolveId: (value: unknown) => string | null = defaultResolveId,
): SanitizedGraphResult<TNode, TLink> {
  const nodeIdSet = new Set(nodes.map((node) => node.id))
  const sanitizedLinks: Array<Omit<TLink, 'source' | 'target'> & SanitizedGraphLink> = []
  const droppedExamples: Array<{ source: unknown; target: unknown }> = []

  for (const link of links) {
    const source = resolveId(link.source)
    const target = resolveId(link.target)
    if (!source || !target || !nodeIdSet.has(source) || !nodeIdSet.has(target)) {
      if (droppedExamples.length < 5) droppedExamples.push({ source: link.source, target: link.target })
      continue
    }
    sanitizedLinks.push({ ...link, source, target })
  }

  return {
    nodes,
    links: sanitizedLinks,
    droppedLinksCount: links.length - sanitizedLinks.length,
    droppedExamples,
  }
}
