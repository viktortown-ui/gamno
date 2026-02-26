import { Component, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph3D, { type ForceGraphMethods } from 'react-force-graph-3d'
import { forceCenter, forceCollide, forceLink, forceManyBody, forceX, forceY } from 'd3-force'
import { Sprite, SpriteMaterial, CanvasTexture, Color, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, SphereGeometry } from 'three'
import { METRICS, type MetricId } from '../../core/metrics'
import type { InfluenceEdge } from '../../core/engines/influence/influence'

type GraphNode = {
  id: MetricId
  name: string
  val: number
  score: number
  inScore: number
  outScore: number
  x?: number
  y?: number
  z?: number
  vx?: number
  vy?: number
  vz?: number
}

type GraphLink = {
  source: string | GraphNode
  target: string | GraphNode
  from: MetricId
  to: MetricId
  weight: number
  sign: number
}

type OrbitControlsLike = {
  autoRotate?: boolean
  autoRotateSpeed?: number
  update?: () => void
}

interface GraphNode3D extends GraphNode {
  degree: number
}

interface GraphLink3D extends GraphLink {
  source: MetricId | GraphNode3D
  target: MetricId | GraphNode3D
}

export interface GraphMapSelection {
  nodeId?: MetricId
  edge?: { from: MetricId; to: MetricId }
}

interface GraphMap3DProps {
  edges: InfluenceEdge[]
  selectedNodeId: MetricId | null
  selectedEdge: { from: MetricId; to: MetricId } | null
  autoOrbitEnabled: boolean
  onNodeHover: (node: MetricId | null, point: { x: number; y: number } | null) => void
  onNodeClick: (node: MetricId) => void
  onLinkHover: (edge: { from: MetricId; to: MetricId } | null) => void
  onLinkClick: (edge: { from: MetricId; to: MetricId }) => void
  focusRequest: GraphMapSelection | null
  onOpenMatrix: () => void
}

const RESET_CAMERA = { x: 0, y: 0, z: 340 }
const INITIAL_COOLDOWN_TICKS = 320
const INITIAL_WARMUP_TICKS = 140
const IDLE_RESUME_MS = 2600
const ISOLATE_BOUND_RADIUS = 120

function isWebglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return Boolean(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
  } catch {
    return false
  }
}

function labelSprite(text: string): Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  if (!ctx) return new Sprite()
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = 'rgba(9, 12, 26, 0.9)'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#ffffff'
  ctx.font = '42px system-ui'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, canvas.width / 2, canvas.height / 2)
  const texture = new CanvasTexture(canvas)
  const sprite = new Sprite(new SpriteMaterial({ map: texture, transparent: true }))
  sprite.scale.set(28, 7, 1)
  sprite.position.set(0, 9, 0)
  return sprite
}

function GraphMapFallback({ onOpenMatrix }: { onOpenMatrix: () => void }) {
  return <div className="graph-3d-fallback panel">
    <p>WebGL недоступен на этом устройстве. Включите аппаратное ускорение или используйте режим «Матрица».</p>
    <button type="button" className="chip" onClick={onOpenMatrix}>Открыть «Матрица»</button>
  </div>
}

class GraphMapErrorBoundary extends Component<{ children: ReactNode; onError: () => void }, { hasError: boolean }> {
  constructor(props: { children: ReactNode; onError: () => void }) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true }
  }

  componentDidCatch(): void {
    this.props.onError()
  }

  render(): ReactNode {
    if (this.state.hasError) return null
    return this.props.children
  }
}

export function GraphMap3D(props: GraphMap3DProps) {
  const {
    edges,
    selectedNodeId,
    selectedEdge,
    autoOrbitEnabled,
    onNodeHover,
    onNodeClick,
    onLinkHover,
    onLinkClick,
    focusRequest,
    onOpenMatrix,
  } = props
  const [webglReady] = useState(() => (typeof document === 'undefined' ? true : isWebglAvailable()))
  const [webglFailed, setWebglFailed] = useState(false)
  const fgRef = useRef<ForceGraphMethods<GraphNode3D, GraphLink3D> | null>(null)
  const idleTimer = useRef<number | null>(null)
  const hasInitialFit = useRef(false)
  const [isInteracting, setIsInteracting] = useState(false)
  const [isFrozen, setIsFrozen] = useState(false)
  const [hoveredNodeIdLocal, setHoveredNodeIdLocal] = useState<MetricId | null>(null)
  const [autoOrbitAllowed, setAutoOrbitAllowed] = useState(true)

  const nodes = useMemo<GraphNode3D[]>(() => {
    const degreeMap = METRICS.reduce<Record<MetricId, { in: number; out: number }>>((acc, metric) => {
      acc[metric.id] = { in: 0, out: 0 }
      return acc
    }, {} as Record<MetricId, { in: number; out: number }>)
    edges.forEach((edge) => {
      degreeMap[edge.from].out += Math.abs(edge.weight)
      degreeMap[edge.to].in += Math.abs(edge.weight)
    })
    return METRICS.map((metric, index) => {
      const inScore = degreeMap[metric.id].in
      const outScore = degreeMap[metric.id].out
      const sumScore = inScore + outScore
      const degree = Number(inScore > 0) + Number(outScore > 0)
      const anchorRadius = 24 + index * 1.6
      const anchorAngle = (index / Math.max(1, METRICS.length)) * Math.PI * 2
      return {
        id: metric.id,
        name: metric.labelRu,
        inScore,
        outScore,
        score: sumScore,
        degree,
        val: Math.max(2, 2 + sumScore * 4),
        x: degree === 0 ? Math.cos(anchorAngle) * anchorRadius : undefined,
        y: degree === 0 ? Math.sin(anchorAngle) * anchorRadius : undefined,
        z: degree === 0 ? (index % 5) * 6 - 12 : undefined,
      }
    })
  }, [edges])

  const links = useMemo<GraphLink3D[]>(() => edges.map((edge) => ({
    source: edge.from,
    target: edge.to,
    from: edge.from,
    to: edge.to,
    weight: edge.weight,
    sign: edge.weight >= 0 ? 1 : -1,
  })), [edges])

  const isolatedNodeIds = useMemo(() => new Set(nodes.filter((node) => node.degree === 0).map((node) => node.id)), [nodes])
  const graphData = useMemo(() => ({ nodes, links }), [nodes, links])

  useEffect(() => {
    const graph = fgRef.current
    if (!graph) return
    const chargeForce = forceManyBody<GraphNode3D>().strength((node) => -58 - node.val * 4)
    const linkForce = forceLink<GraphNode3D, GraphLink3D>(links)
      .id((node) => node.id)
      .distance((link) => 52 + (1 - Math.min(1, Math.abs(link.weight))) * 34)
      .strength((link) => 0.35 + Math.abs(link.weight) * 0.25)
    const isolateAnchorForce = () => {
      for (const node of nodes) {
        if (!isolatedNodeIds.has(node.id)) continue
        const x = node.x ?? 0
        const y = node.y ?? 0
        const z = node.z ?? 0
        const distance = Math.sqrt(x * x + y * y + z * z) || 1
        const pull = distance > ISOLATE_BOUND_RADIUS ? 0.055 : 0.025
        node.vx = (node.vx ?? 0) - (x / distance) * pull
        node.vy = (node.vy ?? 0) - (y / distance) * pull
        node.vz = (node.vz ?? 0) - (z / distance) * pull
      }
    }

    graph.d3Force('charge', chargeForce)
    graph.d3Force('link', linkForce)
    graph.d3Force('center', forceCenter<GraphNode3D>(0, 0))
    graph.d3Force('collide', forceCollide<GraphNode3D>().radius((node) => Math.max(6, node.val * 1.2)).strength(0.85))
    graph.d3Force('x', forceX<GraphNode3D>(0).strength(0.02))
    graph.d3Force('y', forceY<GraphNode3D>(0).strength(0.02))
    graph.d3Force('z', () => {
      for (const node of nodes) {
        node.vz = (node.vz ?? 0) - (node.z ?? 0) * 0.02
      }
    })
    graph.d3Force('isolate-anchor', isolateAnchorForce)
  }, [isolatedNodeIds, links, nodes])

  useEffect(() => {
    const graph = fgRef.current
    if (!graph || hasInitialFit.current) return
    graph.cameraPosition(RESET_CAMERA, { x: 0, y: 0, z: 0 }, 500)
    graph.zoomToFit(500, 40)
    hasInitialFit.current = true
  }, [links])

  useEffect(() => {
    const graph = fgRef.current
    if (!graph || !focusRequest) return
    if (focusRequest.nodeId) {
      const node = nodes.find((item) => item.id === focusRequest.nodeId)
      if (node?.x != null && node.y != null && node.z != null) {
        graph.cameraPosition({ x: node.x + 70, y: node.y + 50, z: node.z + 90 }, { x: node.x, y: node.y, z: node.z }, 700)
      }
    }
    if (focusRequest.edge) {
      const source = nodes.find((item) => item.id === focusRequest.edge?.from)
      const target = nodes.find((item) => item.id === focusRequest.edge?.to)
      if (source?.x != null && source.y != null && source.z != null && target?.x != null && target.y != null && target.z != null) {
        const point = {
          x: (source.x + target.x) / 2,
          y: (source.y + target.y) / 2,
          z: (source.z + target.z) / 2,
        }
        graph.cameraPosition({ x: point.x + 80, y: point.y + 80, z: point.z + 120 }, point, 700)
      }
    }
  }, [focusRequest, nodes])

  useEffect(() => () => {
    if (idleTimer.current) window.clearTimeout(idleTimer.current)
  }, [])

  const onUserInteraction = useCallback(() => {
    setIsInteracting(true)
    setAutoOrbitAllowed(false)
    if (idleTimer.current) window.clearTimeout(idleTimer.current)
    idleTimer.current = window.setTimeout(() => {
      setIsInteracting(false)
      setAutoOrbitAllowed(true)
    }, IDLE_RESUME_MS)
  }, [])

  const shouldOrbit = autoOrbitEnabled && autoOrbitAllowed && !isInteracting
  const highlightedNeighbors = useMemo(() => {
    const target = selectedNodeId ?? hoveredNodeIdLocal
    if (!target) return new Set<MetricId>()
    const peers = new Set<MetricId>([target])
    links.forEach((link) => {
      if (link.from === target) peers.add(link.to)
      if (link.to === target) peers.add(link.from)
    })
    return peers
  }, [links, hoveredNodeIdLocal, selectedNodeId])

  useEffect(() => {
    const controls = fgRef.current?.controls() as OrbitControlsLike | undefined
    if (!controls) return
    controls.autoRotate = shouldOrbit
    controls.autoRotateSpeed = 0.2
    controls.update?.()
  }, [shouldOrbit])

  useEffect(() => {
    fgRef.current?.refresh()
  }, [hoveredNodeIdLocal, selectedEdge, selectedNodeId])

  useEffect(() => {
    const controls = fgRef.current?.controls() as
      | (OrbitControlsLike & {
        addEventListener?: (eventName: string, listener: () => void) => void
        removeEventListener?: (eventName: string, listener: () => void) => void
      })
      | undefined
    if (!controls?.addEventListener || !controls.removeEventListener) return

    controls.addEventListener('start', onUserInteraction)
    controls.addEventListener('change', onUserInteraction)
    return () => {
      controls.removeEventListener?.('start', onUserInteraction)
      controls.removeEventListener?.('change', onUserInteraction)
    }
  }, [onUserInteraction])

  const runZoomToFit = () => fgRef.current?.zoomToFit(500, 40)
  const resetView = () => {
    const graph = fgRef.current
    if (!graph) return
    graph.cameraPosition(RESET_CAMERA, { x: 0, y: 0, z: 0 }, 500)
    graph.zoomToFit(500, 40)
  }

  const focusSelectedNode = () => {
    if (!selectedNodeId) return
    const node = nodes.find((item) => item.id === selectedNodeId)
    if (!node || node.x == null || node.y == null || node.z == null) return
    fgRef.current?.cameraPosition({ x: node.x + 70, y: node.y + 50, z: node.z + 90 }, { x: node.x, y: node.y, z: node.z }, 700)
  }

  const toggleSimulation = () => {
    const graph = fgRef.current
    if (!graph) return
    if (isFrozen) {
      graph.resumeAnimation()
      graph.d3ReheatSimulation()
      setIsFrozen(false)
      return
    }
    graph.pauseAnimation()
    setIsFrozen(true)
  }

  if (!webglReady || webglFailed) return <GraphMapFallback onOpenMatrix={onOpenMatrix} />

  return <div className="graph-3d-wrap" onMouseDown={onUserInteraction} onWheel={onUserInteraction} onTouchStart={onUserInteraction}>
    <GraphMapErrorBoundary onError={() => setWebglFailed(true)}>
      <ForceGraph3D
        // @ts-expect-error library typings require undefined-based mutable ref; runtime supports standard React ref object.
        ref={fgRef}
        graphData={graphData}
        width={820}
        height={420}
        backgroundColor="#071127"
        showNavInfo={false}
        controlType="orbit"
        warmupTicks={INITIAL_WARMUP_TICKS}
        cooldownTicks={INITIAL_COOLDOWN_TICKS}
        d3AlphaDecay={0.09}
        d3VelocityDecay={0.5}
        nodeRelSize={4}
        nodeOpacity={1}
        nodeLabel={(node) => String((node as GraphNode3D).name ?? '')}
        nodeVisibility={(node) => {
          const camera = fgRef.current?.camera()
          if (!camera) return true
          const nodeData = node as GraphNode3D
          const isFocused = highlightedNeighbors.has(nodeData.id)
          const distance = camera.position.length()
          return isFocused || distance < 1300 || nodeData.score > 0.8
        }}
        nodeThreeObject={(nodeObj) => {
          const node = nodeObj as GraphNode3D
          const group = new Group()
          const isSelected = selectedNodeId === node.id
          const isNeighbor = highlightedNeighbors.has(node.id)
          const showLabel = isSelected || hoveredNodeIdLocal === node.id
          const sphere = new Mesh(
            new SphereGeometry(Math.max(2.2, node.val * 0.45), 24, 24),
            new MeshLambertMaterial({
              color: isSelected ? '#f59e0b' : (isNeighbor ? '#7dd3fc' : '#43f3d0'),
              emissive: new Color(isSelected ? '#7c2d12' : '#0f766e'),
            }),
          )
          const halo = new Mesh(
            new SphereGeometry(Math.max(2.9, node.val * 0.55), 16, 16),
            new MeshBasicMaterial({ color: isSelected ? '#fbbf24' : '#93c5fd', transparent: true, opacity: isNeighbor ? 0.24 : 0.14 }),
          )
          group.add(halo)
          group.add(sphere)
          if (showLabel) group.add(labelSprite(node.name))
          return group
        }}
        onNodeHover={(node) => {
          const nextNode = node as GraphNode3D | null
          setHoveredNodeIdLocal(nextNode?.id ?? null)
          if (nextNode?.x != null && nextNode.y != null && nextNode.z != null) {
            const point = fgRef.current?.graph2ScreenCoords(nextNode.x, nextNode.y, nextNode.z)
            onNodeHover(nextNode.id, point ? { x: point.x, y: point.y } : null)
            return
          }
          onNodeHover(nextNode?.id ?? null, null)
        }}
        onNodeClick={(node) => {
          onUserInteraction()
          const graphNode = node as GraphNode3D
          if (graphNode.x != null && graphNode.y != null && graphNode.z != null) {
            fgRef.current?.cameraPosition({ x: graphNode.x + 70, y: graphNode.y + 50, z: graphNode.z + 90 }, { x: graphNode.x, y: graphNode.y, z: graphNode.z }, 700)
          }
          onNodeClick(graphNode.id)
        }}
        linkColor={(linkObj) => {
          const link = linkObj as GraphLink3D
          if (selectedEdge && selectedEdge.from === link.from && selectedEdge.to === link.to) return '#f59e0b'
          if (selectedNodeId && (link.from === selectedNodeId || link.to === selectedNodeId)) return '#f8fafc'
          return link.weight >= 0 ? 'rgba(67,243,208,0.85)' : 'rgba(192,132,252,0.88)'
        }}
        linkWidth={(linkObj) => {
          const link = linkObj as GraphLink3D
          const base = Math.max(0.8, Math.abs(link.weight) * 4.6)
          if (selectedEdge && selectedEdge.from === link.from && selectedEdge.to === link.to) return base + 2
          if (selectedNodeId && (link.from === selectedNodeId || link.to === selectedNodeId)) return base + 1
          return base
        }}
        linkOpacity={0.72}
        linkDirectionalParticles={(linkObj) => Math.min(2, Math.max(0, Math.round(Math.abs((linkObj as GraphLink3D).weight) * 1.5)))}
        linkDirectionalParticleWidth={1.3}
        linkDirectionalParticleSpeed={(linkObj) => Math.max(0.0018, Math.abs((linkObj as GraphLink3D).weight) * 0.006)}
        onLinkHover={(linkObj) => {
          const link = linkObj as GraphLink3D | null
          if (!link) return onLinkHover(null)
          onLinkHover({ from: link.from, to: link.to })
        }}
        onLinkClick={(linkObj) => {
          onUserInteraction()
          const link = linkObj as GraphLink3D
          const source = typeof link.source === 'string' ? null : link.source
          const target = typeof link.target === 'string' ? null : link.target
          if (source?.x != null && source.y != null && source.z != null && target?.x != null && target.y != null && target.z != null) {
            const midpoint = {
              x: (source.x + target.x) / 2,
              y: (source.y + target.y) / 2,
              z: (source.z + target.z) / 2,
            }
            fgRef.current?.cameraPosition({ x: midpoint.x + 80, y: midpoint.y + 80, z: midpoint.z + 120 }, midpoint, 700)
          }
          onLinkClick({ from: link.from, to: link.to })
        }}
        enableNodeDrag={false}
      />
    </GraphMapErrorBoundary>
    <div className="graph-3d-actions">
      <button type="button" className="chip" title="Подогнать весь граф в видимую область" onClick={runZoomToFit}>Подогнать вид</button>
      <button type="button" className="chip" title="Вернуть стартовую камеру и масштаб" onClick={resetView}>Сброс вида</button>
      <button type="button" className="chip" onClick={focusSelectedNode} disabled={!selectedNodeId}>Фокус узла</button>
      <button type="button" className="chip" title="Остановить/запустить движение силовой симуляции" onClick={toggleSimulation}>{isFrozen ? 'Оживить' : 'Заморозить'}</button>
      <span className="graph-3d-help" title="Управление: ЛКМ/тач — вращение, колесо — зум, клик по узлу или связи — фокус.">?</span>
    </div>
    <div className="graph-3d-legend" aria-label="Легенда карты">
      <span><i className="graph-3d-legend-line graph-3d-legend-line--plus" /> + влияние</span>
      <span><i className="graph-3d-legend-line graph-3d-legend-line--minus" /> − влияние</span>
      <span>Толщина = сила связи</span>
    </div>
  </div>
}
