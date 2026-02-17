import { useEffect, useMemo, useState } from 'react'
import { forceCenter, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force'
import { METRICS, type MetricId } from '../core/metrics'
import { applyImpulse, defaultInfluenceMatrix, type InfluenceEdge } from '../core/engines/influence/influence'
import { getTopEdges } from '../core/engines/influence/graphView'
import type { InfluenceMatrix, MetricVector } from '../core/engines/influence/types'
import { loadInfluenceMatrix, resetInfluenceMatrix, saveInfluenceMatrix } from '../core/storage/repo'

type ViewMode = 'levers' | 'map' | 'matrix'

interface GraphNode { id: MetricId; x?: number; y?: number }

export function GraphPage() {
  const [matrix, setMatrix] = useState<InfluenceMatrix>(defaultInfluenceMatrix)
  const [mode, setMode] = useState<ViewMode>('levers')
  const [selectedEdge, setSelectedEdge] = useState<{ from: MetricId; to: MetricId } | null>(null)
  const [source, setSource] = useState<MetricId | 'all'>('all')
  const [target, setTarget] = useState<MetricId | 'all'>('all')
  const [sign, setSign] = useState<'all' | 'positive' | 'negative'>('all')
  const [threshold, setThreshold] = useState(0.2)
  const [search, setSearch] = useState('')
  const [topN, setTopN] = useState(15)
  const [impulseMetric, setImpulseMetric] = useState<MetricId>('sleepHours')
  const [delta, setDelta] = useState(1)
  const [steps, setSteps] = useState<1 | 2 | 3>(2)
  const [testResult, setTestResult] = useState<MetricVector | null>(null)

  useEffect(() => { void loadInfluenceMatrix().then(setMatrix) }, [])

  const metricIds = METRICS.map((m) => m.id)

  const topEdges = useMemo(
    () => getTopEdges(matrix, { source, target, sign, threshold, search, topN }),
    [matrix, source, target, sign, threshold, search, topN],
  )

  const mapEdges = useMemo(
    () => getTopEdges(matrix, { sign: 'all', threshold: 0.15, topN: Number.MAX_SAFE_INTEGER }),
    [matrix],
  )

  const nodes = useMemo(() => {
    const width = 820
    const height = 420
    const simNodes: GraphNode[] = metricIds.map((id) => ({ id }))
    const links = mapEdges.map((edge) => ({ source: edge.from, target: edge.to, weight: edge.weight }))
    const simulation = forceSimulation(simNodes)
      .force('charge', forceManyBody().strength(-220))
      .force('center', forceCenter(width / 2, height / 2))
      .force('x', forceX(width / 2).strength(0.03))
      .force('y', forceY(height / 2).strength(0.03))
      .force('link', forceLink(links).id((d) => (d as GraphNode).id).distance(120).strength(0.5))
      .stop()

    for (let i = 0; i < 90; i += 1) simulation.tick()
    return simNodes
  }, [mapEdges, metricIds])

  const selectedWeight = selectedEdge ? matrix[selectedEdge.from]?.[selectedEdge.to] ?? 0 : 0

  const updateEdge = (from: MetricId, to: MetricId, weight: number) => {
    setMatrix((prev) => ({ ...prev, [from]: { ...prev[from], [to]: weight } }))
  }

  const selectEdge = (edge: InfluenceEdge | null) => {
    if (!edge) {
      setSelectedEdge(null)
      return
    }
    setSelectedEdge({ from: edge.from, to: edge.to })
  }

  const activeNode = selectedEdge?.from

  return <section className="page graph-page">
    <h1>Граф влияний</h1>
    <div className="mode-tabs">
      <button type="button" className={mode === 'levers' ? 'filter-button filter-button--active' : 'filter-button'} onClick={() => setMode('levers')}>Рычаги</button>
      <button type="button" className={mode === 'map' ? 'filter-button filter-button--active' : 'filter-button'} onClick={() => setMode('map')}>Карта</button>
      <button type="button" className={mode === 'matrix' ? 'filter-button filter-button--active' : 'filter-button'} onClick={() => setMode('matrix')}>Матрица</button>
    </div>

    <div className="graph-layout">
      <div>
        {mode === 'levers' && (
          <>
            <div className="filters graph-filters">
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск по метрике" />
              <select value={source} onChange={(e) => setSource(e.target.value as MetricId | 'all')}><option value="all">Источник: все</option>{METRICS.map((m) => <option key={m.id} value={m.id}>{m.labelRu}</option>)}</select>
              <select value={target} onChange={(e) => setTarget(e.target.value as MetricId | 'all')}><option value="all">Цель: все</option>{METRICS.map((m) => <option key={m.id} value={m.id}>{m.labelRu}</option>)}</select>
              <select value={sign} onChange={(e) => setSign(e.target.value as typeof sign)}><option value="all">Любой знак</option><option value="positive">Только усиливает</option><option value="negative">Только ослабляет</option></select>
              <label>|w| ≥ <input type="number" step={0.05} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} /></label>
              <label>Топ N <input type="number" min={1} max={40} value={topN} onChange={(e) => setTopN(Number(e.target.value))} /></label>
            </div>
            <table className="table table--dense"><thead><tr><th>От</th><th>К</th><th>Вес</th><th>Смысл</th></tr></thead>
              <tbody>{topEdges.map((edge) => <tr key={`${edge.from}-${edge.to}`} onClick={() => selectEdge(edge)} className={selectedEdge?.from === edge.from && selectedEdge?.to === edge.to ? 'row-active' : ''}><td>{METRICS.find((m) => m.id === edge.from)?.labelRu}</td><td>{METRICS.find((m) => m.id === edge.to)?.labelRu}</td><td>{edge.weight > 0 ? '+' : ''}{edge.weight.toFixed(2)}</td><td>{edge.weight >= 0 ? 'усиливает' : 'ослабляет'}</td></tr>)}</tbody></table>
          </>
        )}

        {mode === 'map' && (
          <svg viewBox="0 0 820 420" className="graph-canvas" role="img" aria-label="Карта влияния">
            {mapEdges.map((edge) => {
              const from = nodes.find((n) => n.id === edge.from)
              const to = nodes.find((n) => n.id === edge.to)
              if (!from?.x || !from?.y || !to?.x || !to?.y) return null
              const related = !activeNode || edge.from === activeNode || edge.to === activeNode
              return <line key={`${edge.from}-${edge.to}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={edge.weight >= 0 ? '#16a34a' : '#dc2626'} strokeWidth={Math.max(1, edge.absWeight * 6)} opacity={related ? 0.9 : 0.15} onClick={() => selectEdge(edge)} />
            })}
            {nodes.map((node) => {
              const label = METRICS.find((m) => m.id === node.id)?.labelRu ?? node.id
              const isActive = activeNode === node.id
              return <g key={node.id} transform={`translate(${node.x ?? 0}, ${node.y ?? 0})`} onClick={() => setSelectedEdge({ from: node.id, to: Object.keys(matrix[node.id] ?? {})[0] as MetricId })}>
                <circle r={isActive ? 20 : 15} fill={isActive ? '#0f172a' : '#1e293b'} />
                <text y={4} fill="#fff" textAnchor="middle" fontSize={10}>{label}</text>
              </g>
            })}
          </svg>
        )}

        {mode === 'matrix' && (
          <table className="table table--dense"><thead><tr><th>От \ К</th>{metricIds.map((id) => <th key={id}>{METRICS.find((m) => m.id === id)?.labelRu}</th>)}</tr></thead>
            <tbody>{metricIds.map((fromId) => <tr key={fromId}><td>{METRICS.find((m) => m.id === fromId)?.labelRu}</td>{metricIds.map((toId) => {
              const weight = matrix[fromId]?.[toId] ?? 0
              return <td key={toId}><button type="button" className="heat-cell" style={{ background: `rgba(${weight > 0 ? '22,163,74' : '220,38,38'}, ${Math.abs(weight)})` }} onClick={() => setSelectedEdge({ from: fromId, to: toId })}>{weight.toFixed(1)}</button></td>
            })}</tr>)}</tbody></table>
        )}
      </div>

      <aside className="inspector">
        <h2>Инспектор связи</h2>
        {!selectedEdge ? <p>Выберите связь в списке, на карте или в матрице.</p> : <>
          <p><strong>{METRICS.find((m) => m.id === selectedEdge.from)?.labelRu}</strong> → <strong>{METRICS.find((m) => m.id === selectedEdge.to)?.labelRu}</strong></p>
          <p>{selectedWeight >= 0 ? 'Усиливает' : 'Ослабляет'} на {Math.abs(selectedWeight).toFixed(2)}</p>
          <input type="range" min={-1} max={1} step={0.05} value={selectedWeight} onChange={(e) => updateEdge(selectedEdge.from, selectedEdge.to, Number(e.target.value))} />
          <div className="preset-row">{[-0.8, -0.4, 0, 0.4, 0.8].map((preset) => <button key={preset} type="button" className="filter-button" onClick={() => updateEdge(selectedEdge.from, selectedEdge.to, preset)}>{preset > 0 ? '+' : ''}{preset}</button>)}</div>
        </>}
        <div className="settings-actions">
          <button type="button" onClick={() => saveInfluenceMatrix(matrix)}>Сохранить карту</button>
          <button type="button" onClick={async () => { await resetInfluenceMatrix(); setMatrix(await loadInfluenceMatrix()) }}>Сброс к умолчанию</button>
        </div>
      </aside>
    </div>

    <h2>Тест импульса</h2>
    <label>Метрика<select value={impulseMetric} onChange={(e) => setImpulseMetric(e.target.value as MetricId)}>{metricIds.map((id) => <option key={id} value={id}>{METRICS.find((m) => m.id === id)?.labelRu}</option>)}</select></label>
    <label>Δ<input type="number" value={delta} onChange={(e) => setDelta(Number(e.target.value))} /></label>
    <label>Шаги<select value={steps} onChange={(e) => setSteps(Number(e.target.value) as 1 | 2 | 3)}>{[1,2,3].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
    <button type="button" onClick={() => {
      const base = metricIds.reduce((acc, id) => ({ ...acc, [id]: 5 }), {} as MetricVector)
      base.cashFlow = 0
      setTestResult(applyImpulse(base, { [impulseMetric]: delta }, matrix, steps))
    }}>Запустить</button>
    {testResult && <p>Результат: {METRICS.map((m) => `${m.labelRu}: ${testResult[m.id].toFixed(1)}`).join(' | ')}</p>}
  </section>
}
