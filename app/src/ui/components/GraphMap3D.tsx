import { Component, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph3D, { type ForceGraphMethods } from 'react-force-graph-3d'
import { Sprite, SpriteMaterial, CanvasTexture, Color, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, SphereGeometry } from 'three'
import { METRICS, type MetricId } from '../../core/metrics'
import type { InfluenceEdge } from '../../core/engines/influence/influence'

type GraphNode = {
  id: string
  name?: string
  x?: number
  y?: number
  z?: number
} & Record<string, unknown>

type GraphLink = {
  source: string | GraphNode
  target: string | GraphNode
  weight?: number
  sign?: number
} & Record<string, unknown>

type OrbitControlsLike = {
  autoRotate?: boolean
  autoRotateSpeed?: number
  update?: () => void
}

type ForceGraphMethodsLike = ForceGraphMethods<GraphNode, GraphLink> & {
  centerAt: (x?: number, y?: number, ms?: number) => void
}

interface GraphNode3D extends GraphNode {
  id: MetricId
  name: string
  val: number
  inScore: number
  outScore: number
  sumScore: number
}

interface GraphLink3D extends GraphLink {
  source: MetricId
  target: MetricId
  from: MetricId
  to: MetricId
  weight: number
  sign: number
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
  const fgRef = useRef<ForceGraphMethods<GraphNode, GraphLink> | undefined>(undefined)
  const idleTimer = useRef<number | null>(null)
  const [isInteracting, setIsInteracting] = useState(false)

  const nodes = useMemo<GraphNode3D[]>(() => {
    const degreeMap = METRICS.reduce<Record<MetricId, { in: number; out: number }>>((acc, metric) => {
      acc[metric.id] = { in: 0, out: 0 }
      return acc
    }, {} as Record<MetricId, { in: number; out: number }>)
    edges.forEach((edge) => {
      degreeMap[edge.from].out += Math.abs(edge.weight)
      degreeMap[edge.to].in += Math.abs(edge.weight)
    })
    return METRICS.map((metric) => {
      const inScore = degreeMap[metric.id].in
      const outScore = degreeMap[metric.id].out
      const sumScore = inScore + outScore
      return {
        id: metric.id,
        name: metric.labelRu,
        inScore,
        outScore,
        sumScore,
        val: Math.max(2, 2 + sumScore * 4),
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

  useEffect(() => {
    const graph = fgRef.current as ForceGraphMethodsLike | undefined
    if (!graph) return
    graph.centerAt(0, 0, 400)
    graph.zoomToFit(400, 40)
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

  const onUserInteraction = () => {
    setIsInteracting(true)
    if (idleTimer.current) window.clearTimeout(idleTimer.current)
    idleTimer.current = window.setTimeout(() => setIsInteracting(false), 3000)
  }

  const shouldOrbit = autoOrbitEnabled && !isInteracting

  useEffect(() => {
    const controls = fgRef.current?.controls() as unknown as OrbitControlsLike
    if (!controls) return
    controls.autoRotate = shouldOrbit
    controls.autoRotateSpeed = 0.2
    controls.update?.()
  }, [shouldOrbit])

  if (!webglReady || webglFailed) return <GraphMapFallback onOpenMatrix={onOpenMatrix} />

  return <div className="graph-3d-wrap" onMouseDown={onUserInteraction} onWheel={onUserInteraction}>
    <GraphMapErrorBoundary onError={() => setWebglFailed(true)}>
      <ForceGraph3D
        ref={fgRef}
        graphData={{ nodes, links }}
        width={820}
        height={420}
        backgroundColor="#071127"
        nodeRelSize={4}
        nodeOpacity={1}
        nodeLabel={(node) => String((node as GraphNode3D).name ?? '')}
        nodeVisibility={(node) => {
          const camera = fgRef.current?.camera()
          if (!camera) return true
          const distance = camera.position.length()
          return distance < 1200 || (node as GraphNode3D).sumScore > 0.8
        }}
        nodeThreeObject={(nodeObj) => {
          const node = nodeObj as GraphNode3D
          const group = new Group()
          const isSelected = selectedNodeId === node.id
          const sphere = new Mesh(
            new SphereGeometry(Math.max(2.2, node.val * 0.45), 24, 24),
            new MeshLambertMaterial({ color: isSelected ? '#f59e0b' : '#43f3d0', emissive: new Color(isSelected ? '#7c2d12' : '#0f766e') }),
          )
          const halo = new Mesh(
            new SphereGeometry(Math.max(2.9, node.val * 0.55), 16, 16),
            new MeshBasicMaterial({ color: isSelected ? '#fbbf24' : '#93c5fd', transparent: true, opacity: 0.18 }),
          )
          group.add(halo)
          group.add(sphere)
          group.add(labelSprite(node.name))
          return group
        }}
        onNodeHover={(node, event) => {
          const nextNode = node as GraphNode3D | null
          onNodeHover(nextNode?.id ?? null, event ? { x: event.clientX, y: event.clientY } : null)
        }}
        onNodeClick={(node) => {
          onUserInteraction()
          onNodeClick((node as GraphNode3D).id)
        }}
        linkColor={(linkObj) => {
          const link = linkObj as GraphLink3D
          if (selectedEdge && selectedEdge.from === link.from && selectedEdge.to === link.to) return '#f59e0b'
          if (selectedNodeId && (link.from === selectedNodeId || link.to === selectedNodeId)) return '#f8fafc'
          return (link.weight ?? 0) >= 0 ? '#43f3d0' : '#c084fc'
        }}
        linkWidth={(linkObj) => {
          const link = linkObj as GraphLink3D
          const base = Math.max(0.6, Math.abs(link.weight ?? 0) * 4)
          if (selectedEdge && selectedEdge.from === link.from && selectedEdge.to === link.to) return base + 2
          if (selectedNodeId && (link.from === selectedNodeId || link.to === selectedNodeId)) return base + 1
          return base
        }}
        linkOpacity={0.9}
        linkDirectionalParticles={(linkObj) => Math.min(3, Math.max(0, Math.round(Math.abs((linkObj as GraphLink3D).weight ?? 0) * 2)))}
        linkDirectionalParticleWidth={1.5}
        onLinkHover={(linkObj) => {
          const link = linkObj as GraphLink3D | null
          if (!link) return onLinkHover(null)
          onLinkHover({ from: link.from, to: link.to })
        }}
        onLinkClick={(linkObj) => {
          onUserInteraction()
          const link = linkObj as GraphLink3D
          onLinkClick({ from: link.from, to: link.to })
        }}
        enableNodeDrag={false}
        onEngineStop={() => fgRef.current?.zoomToFit(400, 40)}
      />
    </GraphMapErrorBoundary>
    <div className="graph-3d-actions">
      <button type="button" className="chip" onClick={() => fgRef.current?.zoomToFit(400, 40)}>Подогнать вид</button>
      <button type="button" className="chip" onClick={() => fgRef.current?.cameraPosition(RESET_CAMERA, { x: 0, y: 0, z: 0 }, 500)}>Сброс вида</button>
    </div>
  </div>
}
