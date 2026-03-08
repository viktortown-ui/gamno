import type { GoalRecord } from '../../core/models/goal'
import type { GoalProfile } from './goalProfile'

export type GoalRelationType = 'helps' | 'blocks' | 'depends_on' | 'conflicts_with'
export type GoalSceneMode = 'map' | 'causes' | 'conflicts' | 'execution'

export interface GoalRelationEdge {
  source: string
  target: string
  type: GoalRelationType
  weight: number
  confidence: number
  label: string
  explanation: string
  provenance: 'heuristic' | 'graph' | 'debt' | 'autopilot' | 'user-entered' | 'derived'
}

export interface GoalRelationNode {
  id: string
  title: string
  type: GoalRelationType
  weight: number
  confidence: number
  explanation: string
  provenance: GoalRelationEdge['provenance']
  isPressure?: boolean
  isNextStep?: boolean
}

export interface GoalRootSceneModel {
  centerTitle: string
  mode: GoalSceneMode
  nodes: GoalRelationNode[]
  edges: GoalRelationEdge[]
  pressureNodeId: string | null
}

const limitsByType: Record<GoalRelationType, number> = {
  helps: 4,
  blocks: 4,
  depends_on: 3,
  conflicts_with: 3,
}

const modeVisibility: Record<GoalSceneMode, GoalRelationType[]> = {
  map: ['helps', 'blocks', 'depends_on', 'conflicts_with'],
  causes: ['blocks', 'depends_on'],
  conflicts: ['conflicts_with'],
  execution: ['helps', 'blocks', 'depends_on'],
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, Math.round(value)))

function toNodeId(type: GoalRelationType, label: string): string {
  return `${type}:${label.toLowerCase().replace(/\s+/g, '-').slice(0, 60)}`
}

function makeRelation(params: {
  type: GoalRelationType
  label: string
  weight: number
  confidence: number
  explanation: string
  provenance: GoalRelationEdge['provenance']
  isNextStep?: boolean
}): { node: GoalRelationNode; edge: GoalRelationEdge } {
  const nodeId = toNodeId(params.type, params.label)
  return {
    node: {
      id: nodeId,
      title: params.label,
      type: params.type,
      weight: clamp(params.weight, 0, 100),
      confidence: clamp(params.confidence, 0, 100),
      explanation: params.explanation,
      provenance: params.provenance,
      isNextStep: params.isNextStep,
    },
    edge: {
      source: nodeId,
      target: 'selected-goal',
      type: params.type,
      weight: clamp(params.weight, 0, 100),
      confidence: clamp(params.confidence, 0, 100),
      label: params.label,
      explanation: params.explanation,
      provenance: params.provenance,
    },
  }
}

export function buildGoalRootSceneModel(params: {
  selectedGoal: GoalRecord | null
  allGoals: GoalRecord[]
  profile: GoalProfile | null
  mode: GoalSceneMode
  debtTotal?: number
  blackSwanRisk?: number
  hasSocialInsight?: boolean
}): GoalRootSceneModel | null {
  const { selectedGoal, allGoals, profile, mode, debtTotal = 0, blackSwanRisk = 0, hasSocialInsight = false } = params
  if (!selectedGoal || !profile) return null

  const byTitle = new Map(allGoals.map((goal) => [goal.id, goal.title]))
  const links = selectedGoal.links ?? []
  const relations: GoalRelationNode[] = []
  const edges: GoalRelationEdge[] = []

  const push = (entry: ReturnType<typeof makeRelation>) => {
    if (relations.some((item) => item.id === entry.node.id)) return
    relations.push(entry.node)
    edges.push(entry.edge)
  }

  for (const link of links.filter((item) => item.type === 'supports')) {
    const label = byTitle.get(link.toGoalId)
    if (!label) continue
    push(makeRelation({
      type: 'helps',
      label,
      weight: 68,
      confidence: 78,
      explanation: 'Связь поддержки из карты целей.',
      provenance: 'user-entered',
    }))
  }

  for (const supporter of profile.supporters.slice(0, 4)) {
    push(makeRelation({
      type: 'helps',
      label: supporter,
      weight: 58,
      confidence: hasSocialInsight ? 75 : 52,
      explanation: hasSocialInsight ? 'Поддержка подтверждена социальными сигналами.' : 'Эвристическая поддержка из профиля цели.',
      provenance: hasSocialInsight ? 'derived' : 'heuristic',
    }))
  }

  for (const blocker of profile.blockers.slice(0, 4)) {
    push(makeRelation({
      type: 'blocks',
      label: blocker,
      weight: 70,
      confidence: 72,
      explanation: 'Блокер из диагноза GoalProfile.',
      provenance: 'heuristic',
    }))
  }

  if (debtTotal > 0) {
    push(makeRelation({
      type: 'blocks',
      label: `Долг системы: ${debtTotal.toFixed(1)}`,
      weight: clamp(debtTotal * 14 + 35, 35, 95),
      confidence: 80,
      explanation: 'Долг ограничивает скорость исполнения цели.',
      provenance: 'debt',
    }))
  }

  for (const link of links.filter((item) => item.type === 'depends_on')) {
    const label = byTitle.get(link.toGoalId)
    if (!label) continue
    push(makeRelation({
      type: 'depends_on',
      label,
      weight: 74,
      confidence: 82,
      explanation: 'Зависимость из карты целей.',
      provenance: 'user-entered',
    }))
  }

  for (const dependency of profile.dependencies.slice(0, 3)) {
    push(makeRelation({
      type: 'depends_on',
      label: dependency,
      weight: 64,
      confidence: 67,
      explanation: 'Критическое условие из профиля цели.',
      provenance: 'derived',
    }))
  }

  for (const link of links.filter((item) => item.type === 'conflicts')) {
    const label = byTitle.get(link.toGoalId)
    if (!label) continue
    push(makeRelation({
      type: 'conflicts_with',
      label,
      weight: 76,
      confidence: 84,
      explanation: 'Конфликт целей из карты связей.',
      provenance: 'user-entered',
    }))
  }

  for (const conflict of profile.conflicts.slice(0, 3)) {
    push(makeRelation({
      type: 'conflicts_with',
      label: conflict,
      weight: 69,
      confidence: 71,
      explanation: 'Конфликт приоритетов из GoalProfile.',
      provenance: 'derived',
    }))
  }

  if (blackSwanRisk > 0.2) {
    push(makeRelation({
      type: 'conflicts_with',
      label: `Tail risk ${(blackSwanRisk * 100).toFixed(0)}%`,
      weight: clamp(blackSwanRisk * 100, 45, 98),
      confidence: 64,
      explanation: 'Сценарный риск из Black Swan.',
      provenance: 'graph',
    }))
  }

  const nextStepLabel = profile.decision.actionTitle
  if (nextStepLabel) {
    push(makeRelation({
      type: 'depends_on',
      label: `Шаг: ${nextStepLabel}`,
      weight: 72,
      confidence: 76,
      explanation: 'Лучший шаг из кузницы решения.',
      provenance: 'autopilot',
      isNextStep: true,
    }))
  }

  const visibleTypes = new Set(modeVisibility[mode])
  const filtered = relations
    .filter((item) => visibleTypes.has(item.type))
    .sort((a, b) => b.weight - a.weight)

  const seenByType: Record<GoalRelationType, number> = {
    helps: 0,
    blocks: 0,
    depends_on: 0,
    conflicts_with: 0,
  }
  const capped = filtered.filter((item) => {
    if (seenByType[item.type] >= limitsByType[item.type]) return false
    seenByType[item.type] += 1
    return true
  })

  const capIds = new Set(capped.map((item) => item.id))
  const cappedEdges = edges.filter((edge) => capIds.has(edge.source) && visibleTypes.has(edge.type))

  const pressureNode = capped.find((item) => item.type === 'blocks')
    ?? capped.find((item) => item.type === 'depends_on')
    ?? capped.find((item) => item.type === 'conflicts_with')
    ?? capped[0]
    ?? null

  const nextStepNode = capped.find((item) => item.isNextStep)
  const decoratedNodes = capped.map((item) => ({
    ...item,
    isPressure: pressureNode?.id === item.id,
    isNextStep: nextStepNode?.id === item.id,
  }))

  return {
    centerTitle: selectedGoal.title,
    mode,
    nodes: decoratedNodes,
    edges: cappedEdges,
    pressureNodeId: pressureNode?.id ?? null,
  }
}
