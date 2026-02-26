import { useMemo, useState } from 'react'
import { hierarchy, tree, type HierarchyPointLink, type HierarchyPointNode } from 'd3-hierarchy'
import { METRICS, type MetricId } from '../../core/metrics'
import type { GoalKeyResult, GoalRecord } from '../../core/models/goal'
import type { suggestGoalActions } from '../../core/engines/goal'

type GoalAction = ReturnType<typeof suggestGoalActions>[number]
type TreeWeather = 'storm' | 'grow' | 'dry'
type TreeNodeKind = 'objective' | 'kr' | 'mission'

interface TreeNodeData {
  id: string
  label: string
  kind: TreeNodeKind
  tone: 'grow' | 'risk'
  weight: number
  metricId?: MetricId
  kr?: GoalKeyResult
  mission?: GoalAction | { titleRu: string; rationaleRu: string }
  children?: TreeNodeData[]
}

interface Props {
  goal: GoalRecord
  actions: GoalAction[]
  weather: TreeWeather
}

const metricName = new Map(METRICS.map((metric) => [metric.id, metric.labelRu]))

export function GoalYggdrasilTree({ goal, actions, weather }: Props) {
  const [selectedKrId, setSelectedKrId] = useState<string | null>(null)
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)

  const treeData = useMemo<TreeNodeData>(() => {
    const keyResults: GoalKeyResult[] = goal.okr.keyResults.length > 0
      ? goal.okr.keyResults
      : Object.entries(goal.weights)
        .sort((a, b) => Math.abs(b[1] ?? 0) - Math.abs(a[1] ?? 0))
        .slice(0, 3)
        .map(([metricId, weight], index) => ({
          id: `fallback-${metricId}-${index}`,
          metricId: metricId as MetricId,
          direction: (weight ?? 0) >= 0 ? 'up' : 'down',
          note: 'Собрано автоматически из активных весов',
        }))

    const children: TreeNodeData[] = keyResults.map((kr, index) => {
      const relatedActions = actions.filter((action) => action.metricId === kr.metricId)
      const leaves: TreeNodeData[] = (relatedActions.length > 0
        ? relatedActions.slice(0, 3)
        : [{
          titleRu: `Миссия: стабилизировать ${metricName.get(kr.metricId) ?? kr.metricId}`,
          rationaleRu: 'Рекомендация появится после обновления чек-ина и пересчёта действий.',
        }]).map((action, leafIndex) => ({
        id: `${kr.id}-mission-${leafIndex}`,
        label: action.titleRu,
        kind: 'mission',
        tone: 'deltaGoalScore' in action && action.deltaGoalScore >= 0 ? 'grow' : 'risk',
        weight: Math.max(0.6, 'deltaGoalScore' in action ? Math.abs(action.deltaGoalScore) : 0.9),
        metricId: kr.metricId,
        mission: action,
      }))

      const signedWeight = goal.weights[kr.metricId] ?? (kr.direction === 'up' ? 0.4 : -0.4)
      return {
        id: kr.id,
        label: `KR${index + 1}: ${metricName.get(kr.metricId) ?? kr.metricId}`,
        kind: 'kr',
        tone: signedWeight >= 0 ? 'grow' : 'risk',
        weight: Math.max(0.9, Math.abs(signedWeight) * 2.2),
        metricId: kr.metricId,
        kr,
        children: leaves,
      }
    })

    return {
      id: goal.id,
      label: goal.okr.objective || goal.title,
      kind: 'objective',
      tone: weather === 'grow' ? 'grow' : 'risk',
      weight: 2.2,
      children,
    }
  }, [actions, goal, weather])

  const { nodes, links, descendantsById } = useMemo(() => {
    const width = 900
    const height = 540
    const root = hierarchy(treeData)
    const laidOut = tree<TreeNodeData>().size([height - 80, width - 180])(root)
    const descendants = new Map<string, Set<string>>()
    laidOut.descendants().forEach((node: HierarchyPointNode<TreeNodeData>) => {
      descendants.set(node.data.id, new Set(node.descendants().map((item: HierarchyPointNode<TreeNodeData>) => item.data.id)))
    })
    return {
      nodes: laidOut.descendants(),
      links: laidOut.links(),
      descendantsById: descendants,
    }
  }, [treeData])

  const highlightedSet = useMemo(() => {
    if (!hoveredNodeId) return null
    return descendantsById.get(hoveredNodeId) ?? null
  }, [descendantsById, hoveredNodeId])

  const selectedKrNode = useMemo(
    () => nodes.find((node: HierarchyPointNode<TreeNodeData>) => node.data.kind === 'kr' && node.data.id === selectedKrId)?.data ?? null,
    [nodes, selectedKrId],
  )

  const recommendedLeaf = useMemo(() => {
    if (!selectedKrNode) return null
    const missions = selectedKrNode.children?.map((item) => item.mission).filter(Boolean)
    return missions?.[0] ?? null
  }, [selectedKrNode])

  return (
    <div className="goal-yggdrasil">
      <div className="goal-yggdrasil__head">
        <h3>Иггдрасиль цели</h3>
        <button type="button" onClick={() => { setSelectedKrId(null); setHoveredNodeId(null) }}>Фокус на стволе</button>
      </div>

      <div className="goal-yggdrasil__layout">
        <div className={`goal-yggdrasil__scene goal-yggdrasil__scene--${weather}`}>
          <svg viewBox="0 0 900 540" role="img" aria-label="Дерево цели с ветвями KR и листьями миссий">
            <defs>
              <radialGradient id="ygg-glow" cx="50%" cy="55%" r="65%">
                <stop offset="0%" stopColor="rgba(67, 245, 198, 0.18)" />
                <stop offset="100%" stopColor="rgba(67, 245, 198, 0)" />
              </radialGradient>
            </defs>
            <rect className="goal-yggdrasil__fx-glow" x={0} y={0} width={900} height={540} fill="url(#ygg-glow)" />
            {weather === 'storm' ? (
              <g className="goal-yggdrasil__particles" aria-hidden="true">
                {Array.from({ length: 14 }, (_, index) => (
                  <circle key={index} cx={80 + ((index * 57) % 720)} cy={50 + ((index * 91) % 420)} r={1.8 + (index % 3)} />
                ))}
              </g>
            ) : null}

            <g className="goal-yggdrasil__tree">
              {links.map((link: HierarchyPointLink<TreeNodeData>) => {
                const midX = (link.source.y + link.target.y) / 2
                const tone = link.target.data.tone
                const isHighlighted = !highlightedSet || (highlightedSet.has(link.source.data.id) && highlightedSet.has(link.target.data.id))
                return (
                  <path
                    key={`${link.source.data.id}-${link.target.data.id}`}
                    d={`M ${link.source.y + 60} ${link.source.x + 40} C ${midX + 60} ${link.source.x + 40}, ${midX + 60} ${link.target.x + 40}, ${link.target.y + 60} ${link.target.x + 40}`}
                    className={`goal-yggdrasil__edge goal-yggdrasil__edge--${tone}`}
                    strokeWidth={1.5 + link.target.data.weight * 1.1}
                    opacity={isHighlighted ? 0.95 : 0.2}
                  />
                )
              })}

              {nodes.map((node: HierarchyPointNode<TreeNodeData>) => {
                const active = selectedKrId ? node.data.id === selectedKrId || node.parent?.data.id === selectedKrId : true
                const highlighted = !highlightedSet || highlightedSet.has(node.data.id)
                const radius = node.data.kind === 'objective' ? 18 : node.data.kind === 'kr' ? 9 + node.data.weight * 2 : 6 + node.data.weight

                return (
                  <g
                    key={node.data.id}
                    transform={`translate(${node.y + 60}, ${node.x + 40})`}
                    className={`goal-yggdrasil__node goal-yggdrasil__node--${node.data.kind} goal-yggdrasil__node--${node.data.tone}`}
                    opacity={active && highlighted ? 1 : 0.28}
                    onMouseEnter={() => setHoveredNodeId(node.data.id)}
                    onMouseLeave={() => setHoveredNodeId(null)}
                  >
                    <circle r={radius} onClick={() => { if (node.data.kind === 'kr') setSelectedKrId(node.data.id) }} />
                    <text x={node.data.kind === 'objective' ? 24 : 14} y={4}>{node.data.label}</text>
                  </g>
                )
              })}
            </g>
          </svg>
        </div>

        <aside className="goal-yggdrasil__details panel">
          <h4>Детали ветви</h4>
          {selectedKrNode ? (
            <>
              <p><strong>{selectedKrNode.label}</strong></p>
              {selectedKrNode.kr?.note ? <p>{selectedKrNode.kr.note}</p> : null}
              <p>Метрика: {selectedKrNode.metricId ? metricName.get(selectedKrNode.metricId) : ''}.</p>
              {recommendedLeaf ? (
                <div>
                  <h5>Рекомендованный лист</h5>
                  <p><strong>{recommendedLeaf.titleRu}.</strong> {recommendedLeaf.rationaleRu}</p>
                </div>
              ) : <p>Для этой ветви пока нет миссий.</p>}
            </>
          ) : <p>Кликните по ветке KR, чтобы увидеть деталь и рекомендованную миссию.</p>}
        </aside>
      </div>
    </div>
  )
}
