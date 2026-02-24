import { useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph3D from 'react-force-graph-3d'
import { Sprite, SpriteMaterial, CanvasTexture, Color, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, SphereGeometry } from 'three'
import { METRICS, type MetricId } from '../../core/metrics'
import type { InfluenceEdge } from '../../core/engines/influence/influence'

interface GraphNode3D {
  id: MetricId
  name: string
  val: number
  inScore: number
  outScore: number
  sumScore: number
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
}

const RESET_CAMERA = { x: 0, y: 0, z: 340 }

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
  } = props
  const graphRef = useRef<any>(undefined)
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

  useEffect(() => {
    const graph = graphRef.current
    if (!graph) return
    graph.centerAt(0, 0, 400)
    graph.zoomToFit(400, 40)
  }, [edges])

  useEffect(() => {
    const graph = graphRef.current
    if (!graph || !focusRequest) return
    if (focusRequest.nodeId) {
      const node = nodes.find((item) => item.id === focusRequest.nodeId)
      if (node && typeof (node as { x?: number }).x === 'number') {
        const pos = node as GraphNode3D & { x: number; y: number; z: number }
        graph.cameraPosition({ x: pos.x + 70, y: pos.y + 50, z: pos.z + 90 }, pos, 700)
      }
    }
    if (focusRequest.edge) {
      const source = nodes.find((item) => item.id === focusRequest.edge?.from) as (GraphNode3D & { x?: number; y?: number; z?: number }) | undefined
      const target = nodes.find((item) => item.id === focusRequest.edge?.to) as (GraphNode3D & { x?: number; y?: number; z?: number }) | undefined
      if (source?.x != null && target?.x != null) {
        const point = {
          x: (source.x + target.x) / 2,
          y: (source.y! + target.y!) / 2,
          z: (source.z! + target.z!) / 2,
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
    const controls = graphRef.current?.controls?.() as { autoRotate: boolean; autoRotateSpeed: number } | undefined
    if (!controls) return
    controls.autoRotate = shouldOrbit
    controls.autoRotateSpeed = 0.2
  }, [shouldOrbit])

  return <div className="graph-3d-wrap" onMouseDown={onUserInteraction} onWheel={onUserInteraction}>
    <ForceGraph3D
      ref={graphRef}
      graphData={{ nodes, links: edges }}
      width={820}
      height={420}
      backgroundColor="#071127"
      nodeRelSize={4}
      nodeOpacity={1}
      nodeLabel={(node) => (node as GraphNode3D).name}
      nodeVisibility={(node) => {
        const camera = graphRef.current?.camera()
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
        const n = node as GraphNode3D | null
        onNodeHover(n?.id ?? null, event ? { x: event.clientX, y: event.clientY } : null)
      }}
      onNodeClick={(node) => {
        onUserInteraction()
        onNodeClick((node as GraphNode3D).id)
      }}
      linkColor={(link) => {
        const edge = link as InfluenceEdge
        if (selectedEdge && selectedEdge.from === edge.from && selectedEdge.to === edge.to) return '#f59e0b'
        if (selectedNodeId && (edge.from === selectedNodeId || edge.to === selectedNodeId)) return '#f8fafc'
        return edge.weight >= 0 ? '#43f3d0' : '#c084fc'
      }}
      linkWidth={(link) => {
        const edge = link as InfluenceEdge
        const base = Math.max(0.6, Math.abs(edge.weight) * 4)
        if (selectedEdge && selectedEdge.from === edge.from && selectedEdge.to === edge.to) return base + 2
        if (selectedNodeId && (edge.from === selectedNodeId || edge.to === selectedNodeId)) return base + 1
        return base
      }}
      linkOpacity={0.9}
      linkDirectionalParticles={(link) => Math.min(3, Math.max(0, Math.round(Math.abs((link as InfluenceEdge).weight) * 2)))}
      linkDirectionalParticleWidth={1.5}
      onLinkHover={(link) => {
        const edge = link as InfluenceEdge | null
        if (!edge) return onLinkHover(null)
        onLinkHover({ from: edge.from, to: edge.to })
      }}
      onLinkClick={(link) => {
        onUserInteraction()
        const edge = link as InfluenceEdge
        onLinkClick({ from: edge.from, to: edge.to })
      }}
      enableNodeDrag={false}
      onEngineStop={() => graphRef.current?.zoomToFit(400, 40)}
    />
    <div className="graph-3d-actions">
      <button type="button" className="chip" onClick={() => graphRef.current?.zoomToFit(400, 40)}>Подогнать вид</button>
      <button type="button" className="chip" onClick={() => graphRef.current?.cameraPosition(RESET_CAMERA, { x: 0, y: 0, z: 0 }, 500)}>Сброс вида</button>
    </div>
  </div>
}
