import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { forceCenter, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force'
import { METRICS, type MetricId } from '../core/metrics'
import { applyImpulse, defaultInfluenceMatrix, type InfluenceEdge } from '../core/engines/influence/influence'
import { getTopEdges } from '../core/engines/influence/graphView'
import { matrixStabilityScore } from '../core/engines/influence/learnedInfluenceEngine'
import { saveOracleScenarioDraft } from '../core/engines/influence/scenarioDraft'
import { emptyInfluenceMatrix, resolveActiveMatrix } from '../core/engines/influence/weightsSource'
import type { InfluenceMatrix, MetricVector, WeightsSource } from '../core/engines/influence/types'
import {
  clearLearnedMatrices,
  getLearnedMatrix,
  loadInfluenceMatrix,
  recomputeLearnedMatrix,
  resetInfluenceMatrix,
  saveInfluenceMatrix,
} from '../core/storage/repo'
import { formatDateTime } from '../ui/format'
import { LeversDecisionView } from './LeversDecisionView'

type ViewMode = 'levers' | 'map' | 'matrix'
interface GraphNode { id: MetricId; x?: number; y?: number }
type QuickPreset = 'none' | 'strong' | 'positive' | 'negative' | 'confidence'

function edgeMeaning(edge: InfluenceEdge): string {
  const fromLabel = METRICS.find((metric) => metric.id === edge.from)?.labelRu ?? edge.from
  const toLabel = METRICS.find((metric) => metric.id === edge.to)?.labelRu ?? edge.to
  const action = edge.weight >= 0 ? 'усиливает' : 'ослабляет'
  return `${fromLabel} ${action} ${toLabel} при изменении импульса.`
}

function stabilityLabel(score: number): string {
  const level = matrixStabilityScore(score)
  if (level === 'high') return 'высокая'
  if (level === 'medium') return 'средняя'
  return 'низкая'
}

export function GraphPage() {
  const navigate = useNavigate()
  const impulseBlockRef = useRef<HTMLDivElement | null>(null)
  const [manualMatrix, setManualMatrix] = useState<InfluenceMatrix>(defaultInfluenceMatrix)
  const [learnedMatrix, setLearnedMatrix] = useState<InfluenceMatrix>(emptyInfluenceMatrix())
  const [stabilityMatrix, setStabilityMatrix] = useState<InfluenceMatrix>(emptyInfluenceMatrix())
  const [weightsSource, setWeightsSource] = useState<WeightsSource>('manual')
  const [mix, setMix] = useState(0.5)
  const [mode, setMode] = useState<ViewMode>('levers')
  const [trainedOnDays, setTrainedOnDays] = useState<30 | 60 | 'all'>(60)
  const [lags, setLags] = useState<1 | 2 | 3>(2)
  const [learnedMeta, setLearnedMeta] = useState<{ trainedOnDays: number; lags: number; alpha: number; computedAt: number; noteRu: string } | null>(null)
  const [selectedEdge, setSelectedEdge] = useState<{ from: MetricId; to: MetricId } | null>(null)
  const [source, setSource] = useState<MetricId | 'all'>('all')
  const [target, setTarget] = useState<MetricId | 'all'>('all')
  const [sign, setSign] = useState<'all' | 'positive' | 'negative'>('all')
  const [threshold, setThreshold] = useState(0.2)
  const [search, setSearch] = useState('')
  const [topN, setTopN] = useState(15)
  const [quickPreset, setQuickPreset] = useState<QuickPreset>('none')
  const [impulseMetric, setImpulseMetric] = useState<MetricId>('sleepHours')
  const [delta, setDelta] = useState(1)
  const [steps, setSteps] = useState<1 | 2 | 3>(2)
  const [testResult, setTestResult] = useState<MetricVector | null>(null)

  useEffect(() => {
    void (async () => {
      const [manual, learned] = await Promise.all([loadInfluenceMatrix(), getLearnedMatrix()])
      setManualMatrix(manual)
      if (learned) {
        setLearnedMatrix(learned.weights)
        setStabilityMatrix(learned.stability)
        setLearnedMeta(learned.meta)
      }
    })()
  }, [])

  const metricIds = METRICS.map((m) => m.id)
  const activeMatrix = useMemo(
    () => resolveActiveMatrix(weightsSource, manualMatrix, learnedMatrix, mix),
    [weightsSource, manualMatrix, learnedMatrix, mix],
  )

  const topEdges = useMemo(
    () => getTopEdges(activeMatrix, { source, target, sign, threshold, search, topN }),
    [activeMatrix, source, target, sign, threshold, search, topN],
  )

  const visibleEdges = useMemo(() => {
    if (quickPreset !== 'confidence') return topEdges
    return topEdges.filter((edge) => (stabilityMatrix[edge.from]?.[edge.to] ?? 0) >= 0.7)
  }, [quickPreset, stabilityMatrix, topEdges])

  const mapEdges = useMemo(
    () => getTopEdges(activeMatrix, { sign: 'all', threshold: 0.15, topN: Number.MAX_SAFE_INTEGER }),
    [activeMatrix],
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

  const selectedWeight = selectedEdge ? activeMatrix[selectedEdge.from]?.[selectedEdge.to] ?? 0 : 0
  const selectedManualWeight = selectedEdge ? manualMatrix[selectedEdge.from]?.[selectedEdge.to] ?? 0 : 0
  const selectedLearnedWeight = selectedEdge ? learnedMatrix[selectedEdge.from]?.[selectedEdge.to] ?? 0 : 0
  const selectedStability = selectedEdge ? stabilityMatrix[selectedEdge.from]?.[selectedEdge.to] ?? 0 : 0

  const runImpulseTest = (metric: MetricId, value: number) => {
    setImpulseMetric(metric)
    setDelta(value)
    const base = metricIds.reduce((acc, id) => ({ ...acc, [id]: 5 }), {} as MetricVector)
    base.cashFlow = 0
    setTestResult(applyImpulse(base, { [metric]: value }, activeMatrix, steps))
  }

  const forecastForMetric = (metric: MetricId, impulse = 1) => {
    const base = metricIds.reduce((acc, id) => ({ ...acc, [id]: 5 }), {} as MetricVector)
    base.cashFlow = 0
    const result = applyImpulse(base, { [metric]: impulse }, activeMatrix, steps)
    return METRICS
      .map((m) => ({ id: m.id, label: m.labelRu, delta: result[m.id] - base[m.id] }))
      .filter((row) => row.id !== metric)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, 3)
  }

  const topLeversByMetric = useMemo(() => {
    const groups = new Map<MetricId, InfluenceEdge[]>()
    visibleEdges.forEach((edge) => {
      const current = groups.get(edge.from) ?? []
      groups.set(edge.from, [...current, edge])
    })
    return Array.from(groups.entries())
      .map(([metric, edges]) => ({
        metric,
        score: edges.reduce((sum, edge) => sum + Math.abs(edge.weight), 0),
        edges: edges.sort((a, b) => b.absWeight - a.absWeight),
      }))
      .sort((a, b) => b.score - a.score)
  }, [visibleEdges])

  const primaryLever = topLeversByMetric[0]

  const recompute = async () => {
    const learned = await recomputeLearnedMatrix({ trainedOnDays, lags })
    setLearnedMatrix(learned.weights)
    setStabilityMatrix(learned.stability)
    setLearnedMeta(learned.meta)
  }

  const applyEdgeAsScenario = (from: MetricId, to: MetricId, weight: number) => {
    saveOracleScenarioDraft({
      baselineTs: 'latest',
      impulses: { [from]: weight >= 0 ? 1 : -1 },
      focusMetrics: [from, to],
      sourceLabelRu: `Сценарий из графа: ${METRICS.find((m) => m.id === from)?.labelRu ?? from} → ${METRICS.find((m) => m.id === to)?.labelRu ?? to} (${formatDateTime(Date.now())})`,
      weightsSource,
      mix,
    })
    navigate('/oracle?prefill=1')
  }

  const triggerImpulseCheck = (metric: MetricId, value: number) => {
    runImpulseTest(metric, value)
    impulseBlockRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const applyQuickPreset = (preset: QuickPreset) => {
    setQuickPreset(preset)
    if (preset === 'strong') {
      setThreshold(0.45)
      setSign('all')
    }
    if (preset === 'positive') setSign('positive')
    if (preset === 'negative') setSign('negative')
  }

  return <section className="page panel graph-page">
    <h1>Граф влияний</h1>
    <div className="settings-actions"><button type="button" onClick={() => { window.localStorage.setItem('gamno.multiverseDraft', JSON.stringify({ impulses: { [impulseMetric]: delta }, focusMetrics: [impulseMetric], sourceLabelRu: 'Контур из графа', weightsSource, mix })); navigate('/multiverse') }}>Открыть в Мультивселенной</button></div>
    <div className="mode-tabs">
      <button type="button" className={mode === 'levers' ? 'filter-button filter-button--active' : 'filter-button'} onClick={() => setMode('levers')}>Рычаги</button>
      <button type="button" className={mode === 'map' ? 'filter-button filter-button--active' : 'filter-button'} onClick={() => setMode('map')}>Карта</button>
      <button type="button" className={mode === 'matrix' ? 'filter-button filter-button--active' : 'filter-button'} onClick={() => setMode('matrix')}>Матрица</button>
    </div>

    <div className="filters graph-filters">
      <span>Источник весов:</span>
      <button type="button" className={weightsSource === 'manual' ? 'filter-button filter-button--active' : 'filter-button'} onClick={() => setWeightsSource('manual')}>Ручной</button>
      <button type="button" className={weightsSource === 'learned' ? 'filter-button filter-button--active' : 'filter-button'} onClick={() => setWeightsSource('learned')}>Из данных</button>
      <button type="button" className={weightsSource === 'mixed' ? 'filter-button filter-button--active' : 'filter-button'} onClick={() => setWeightsSource('mixed')}>Смешанный</button>
      {weightsSource === 'mixed' && <label>Доля смешивания {mix.toFixed(2)}<input type="range" min={0} max={1} step={0.05} value={mix} onChange={(e) => setMix(Number(e.target.value))} /></label>}
      {learnedMeta && <span>Обновлено: {formatDateTime(learnedMeta.computedAt)} · окно: {learnedMeta.trainedOnDays} дней · лаги: {learnedMeta.lags} · α: {learnedMeta.alpha}</span>}
    </div>

    {!learnedMeta && weightsSource !== 'manual' && (
      <div className="panel empty-state">
        <h2>Карта из данных ещё не построена</h2>
        <p>Обучение использует ежедневную историю чек-инов и заполняет пропущенные дни последним известным значением.</p>
        <div className="filters graph-filters">
          <label>Окно
            <select value={trainedOnDays} onChange={(e) => setTrainedOnDays(e.target.value === 'all' ? 'all' : Number(e.target.value) as 30 | 60)}>
              <option value={30}>30</option>
              <option value={60}>60</option>
              <option value="all">Все дни</option>
            </select>
          </label>
          <label>Лаги
            <select value={lags} onChange={(e) => setLags(Number(e.target.value) as 1 | 2 | 3)}>
              <option value={1}>1</option><option value={2}>2</option><option value={3}>3</option>
            </select>
          </label>
          <button type="button" onClick={() => void recompute()}>Обучить по данным</button>
        </div>
      </div>
    )}

    {mode === 'levers' && <div ref={impulseBlockRef} tabIndex={-1}>
      <LeversDecisionView
        primaryLever={primaryLever}
        alternatives={topLeversByMetric.slice(1, 4)}
        forecastForMetric={forecastForMetric}
        triggerImpulseCheck={triggerImpulseCheck}
        applyEdgeAsScenario={applyEdgeAsScenario}
        search={search}
        setSearch={setSearch}
        source={source}
        setSource={setSource}
        target={target}
        setTarget={setTarget}
        sign={sign}
        setSign={setSign}
        threshold={threshold}
        setThreshold={setThreshold}
        topN={topN}
        setTopN={setTopN}
        quickPreset={quickPreset}
        applyQuickPreset={applyQuickPreset}
        visibleEdges={visibleEdges}
        selectedEdge={selectedEdge}
        setSelectedEdge={setSelectedEdge}
        stabilityLabel={stabilityLabel}
        stabilityMatrix={stabilityMatrix}
        edgeMeaning={edgeMeaning}
        steps={steps}
        runRecompute={() => void recompute()}
        clearLearned={() => void clearLearnedMatrices()}
        selectedManualWeight={selectedManualWeight}
        selectedLearnedWeight={selectedLearnedWeight}
        selectedWeight={selectedWeight}
        selectedStability={selectedStability}
        manualMatrix={manualMatrix}
        setManualMatrix={setManualMatrix}
        saveManual={() => void saveInfluenceMatrix(manualMatrix)}
        resetManual={() => void (async () => { await resetInfluenceMatrix(); setManualMatrix(await loadInfluenceMatrix()) })()}
        impulseMetric={impulseMetric}
        setImpulseMetric={setImpulseMetric}
        delta={delta}
        setDelta={setDelta}
        setSteps={setSteps}
        runImpulseTest={runImpulseTest}
        testResult={testResult}
      />
    </div>}

    {mode !== 'levers' && <div className="graph-layout"><div>
      {mode === 'map' && <svg viewBox="0 0 820 420" className="graph-canvas" role="img" aria-label="Карта влияния">{mapEdges.map((edge) => {
        const from = nodes.find((n) => n.id === edge.from)
        const to = nodes.find((n) => n.id === edge.to)
        if (!from?.x || !from?.y || !to?.x || !to?.y) return null
        return <line key={`${edge.from}-${edge.to}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={edge.weight >= 0 ? '#43f3d0' : '#c084fc'} strokeWidth={Math.max(1, edge.absWeight * 6)} opacity={0.9} onClick={() => setSelectedEdge({ from: edge.from, to: edge.to })} />
      })}{nodes.map((node) => <g key={node.id} transform={`translate(${node.x ?? 0}, ${node.y ?? 0})`}><circle r={15} fill="#1c2440" /><text y={4} fill="#fff" textAnchor="middle" fontSize={10}>{METRICS.find((m) => m.id === node.id)?.labelRu ?? node.id}</text></g>)}</svg>}

      {mode === 'matrix' && <table className="table table--dense"><thead><tr><th>От \ К</th>{metricIds.map((id) => <th key={id}>{METRICS.find((m) => m.id === id)?.labelRu}</th>)}</tr></thead>
        <tbody>{metricIds.map((fromId) => <tr key={fromId}><td>{METRICS.find((m) => m.id === fromId)?.labelRu}</td>{metricIds.map((toId) => {
          const weight = activeMatrix[fromId]?.[toId] ?? 0
          return <td key={toId}><button type="button" className="heat-cell" style={{ background: `rgba(${weight > 0 ? '67,243,208' : '192,132,252'}, ${Math.abs(weight)})` }} onClick={() => setSelectedEdge({ from: fromId, to: toId })}>{weight.toFixed(1)}</button></td>
        })}</tr>)}</tbody></table>}
    </div>

    <aside className="inspector panel">
      <h2>Инспектор связи</h2>
      {!selectedEdge ? <p>Выберите связь на карте или в матрице.</p> : <>
        <p><strong>{METRICS.find((m) => m.id === selectedEdge.from)?.labelRu}</strong> → <strong>{METRICS.find((m) => m.id === selectedEdge.to)?.labelRu}</strong></p>
        <p>Ручной: {selectedManualWeight >= 0 ? '+' : ''}{selectedManualWeight.toFixed(2)}</p>
        <p>Из данных: {selectedLearnedWeight >= 0 ? '+' : ''}{selectedLearnedWeight.toFixed(2)}</p>
        <p>Смешанный: {selectedWeight >= 0 ? '+' : ''}{selectedWeight.toFixed(2)}</p>
        <p>Уверенность: {selectedStability.toFixed(2)} — {stabilityLabel(selectedStability)}</p>
      </>}
    </aside></div>}
  </section>
}
