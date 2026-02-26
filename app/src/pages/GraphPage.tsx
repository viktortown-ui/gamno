import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
  listCheckins,
  loadInfluenceMatrix,
  recomputeLearnedMatrix,
  resetInfluenceMatrix,
  saveInfluenceMatrix,
} from '../core/storage/repo'
import { formatDateTime } from '../ui/format'
import { LeversDecisionView } from './LeversDecisionView'
import type { CheckinRecord } from '../core/models/checkin'
import { encodeContextToQuery, sourceToWeightsMode } from '../core/decisionContext'
import { sendCommand } from '../core/commandBus'
import { loadAppearanceSettings } from '../ui/appearance'
import { GraphMap3D, type GraphMapSelection } from '../ui/components/GraphMap3D'

type ViewMode = 'levers' | 'map' | 'matrix'
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
  const [selectedNodeId, setSelectedNodeId] = useState<MetricId | null>(null)
  const [hoveredNodeId, setHoveredNodeId] = useState<MetricId | null>(null)
  const [hoveredEdge, setHoveredEdge] = useState<{ from: MetricId; to: MetricId } | null>(null)
  const [hoverPoint, setHoverPoint] = useState<{ x: number; y: number } | null>(null)
  const [focusRequest, setFocusRequest] = useState<GraphMapSelection | null>(null)
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
  const [lastCheckSummary, setLastCheckSummary] = useState<string | null>(null)
  const [checkins, setCheckins] = useState<CheckinRecord[]>([])
  const [helpOpen, setHelpOpen] = useState(false)

  useEffect(() => {
    void (async () => {
      const [manual, learned, loadedCheckins] = await Promise.all([loadInfluenceMatrix(), getLearnedMatrix(), listCheckins()])
      setManualMatrix(manual)
      setCheckins(loadedCheckins)
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

  const selectedWeight = selectedEdge ? activeMatrix[selectedEdge.from]?.[selectedEdge.to] ?? 0 : 0
  const selectedManualWeight = selectedEdge ? manualMatrix[selectedEdge.from]?.[selectedEdge.to] ?? 0 : 0
  const selectedLearnedWeight = selectedEdge ? learnedMatrix[selectedEdge.from]?.[selectedEdge.to] ?? 0 : 0
  const selectedStability = selectedEdge ? stabilityMatrix[selectedEdge.from]?.[selectedEdge.to] ?? 0 : 0
  const selectedNodeLabel = selectedNodeId ? METRICS.find((item) => item.id === selectedNodeId)?.labelRu ?? selectedNodeId : null

  const isReducedMotion = useMemo(() => {
    const settings = loadAppearanceSettings()
    return settings.motion !== 'normal' || !settings.fxEnabled || window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }, [])

  const topInfluenceForNode = (nodeId: MetricId, direction: 'in' | 'out', limit: number) => {
    const items = mapEdges
      .filter((edge) => (direction === 'in' ? edge.to === nodeId : edge.from === nodeId))
      .sort((a, b) => b.absWeight - a.absWeight)
      .slice(0, limit)
    return items
  }

  const runImpulseTest = (metric: MetricId, value: number) => {
    setImpulseMetric(metric)
    setDelta(value)
    const base = metricIds.reduce((acc, id) => ({ ...acc, [id]: 5 }), {} as MetricVector)
    base.cashFlow = 0
    const result = applyImpulse(base, { [metric]: value }, activeMatrix, steps)
    setTestResult(result)
    const topEffects = METRICS
      .filter((item) => item.id !== metric)
      .map((item) => ({ label: item.labelRu, delta: result[item.id] - base[item.id] }))
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, 2)
      .map((item) => `${item.label} ${item.delta >= 0 ? '+' : ''}${item.delta.toFixed(1)}`)
      .join(', ')
    const leverLabel = METRICS.find((item) => item.id === metric)?.labelRu ?? metric
    setLastCheckSummary(`при +1 к ${leverLabel} ожидается: ${topEffects} (волны: ${steps})`)
  }

  const forecastForMetric = (metric: MetricId, impulse = 1, stepOverride?: 1 | 2 | 3) => {
    const base = metricIds.reduce((acc, id) => ({ ...acc, [id]: 5 }), {} as MetricVector)
    base.cashFlow = 0
    const result = applyImpulse(base, { [metric]: impulse }, activeMatrix, stepOverride ?? steps)
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


  const runInMultiverse = (metric: MetricId, value: number) => {
    const ctx = {
      sourceTool: 'levers' as const,
      leverKey: metric,
      delta: value,
      waves: steps,
      horizonDays: 14,
      weightsMode: sourceToWeightsMode(weightsSource),
      mixValue: weightsSource === 'mixed' ? mix : undefined,
      noiseLevel: 'on' as const,
      shockProfile: 'normal' as const,
    }
    sendCommand('runMultiverse', ctx)
    navigate({ pathname: '/multiverse', search: `?${encodeContextToQuery(ctx)}` })
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
    <div className="graph-page__title-row">
      <h1>Граф влияний</h1>
      <button
        type="button"
        className="graph-help-button"
        aria-label="Открыть справку по графу"
        onClick={() => setHelpOpen(true)}
      >
        ?
      </button>
    </div>
    <div className="settings-actions"><button type="button" title="Отправить выбранный импульс в симулятор Мультивселенной" onClick={() => {
      const ctx = { sourceTool: 'levers' as const, leverKey: impulseMetric, delta, waves: steps, horizonDays: 14, weightsMode: sourceToWeightsMode(weightsSource), mixValue: weightsSource === 'mixed' ? mix : undefined, noiseLevel: 'on' as const, shockProfile: 'normal' as const }
      sendCommand('runMultiverse', ctx)
      navigate(`/multiverse?${encodeContextToQuery(ctx)}`)
    }}>Прогнать в Мультивселенную</button></div>
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
        allLevers={topLeversByMetric}
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
        learnedMatrix={learnedMatrix}
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
        runInMultiverse={runInMultiverse}
        testResult={testResult}
        lastCheckSummary={lastCheckSummary}
        mapAvailable
        openMap={() => {
          const targetNode = primaryLever?.metric ?? selectedEdge?.from ?? null
          setMode('map')
          if (targetNode) {
            setSelectedNodeId(targetNode)
            setFocusRequest({ nodeId: targetNode })
          }
        }}
        checkins={checkins}
      />
    </div>}

    {mode !== 'levers' && <div className="graph-layout"><div>
      {mode === 'map' && <div className="graph-map-shell">
        <GraphMap3D
          edges={mapEdges}
          selectedNodeId={selectedNodeId}
          selectedEdge={selectedEdge}
          autoOrbitEnabled={!isReducedMotion}
          focusRequest={focusRequest}
          onNodeHover={(nodeId, point) => {
            setHoveredNodeId(nodeId)
            setHoverPoint(point)
            if (nodeId) {
              setSelectedNodeId(nodeId)
              setSelectedEdge(null)
            }
          }}
          onNodeClick={(nodeId) => {
            setSelectedNodeId(nodeId)
            setSelectedEdge(null)
            setFocusRequest({ nodeId })
          }}
          onLinkHover={(edge) => setHoveredEdge(edge)}
          onLinkClick={(edge) => {
            setSelectedEdge(edge)
            setSelectedNodeId(null)
            setFocusRequest({ edge })
          }}
          onOpenMatrix={() => setMode('matrix')}
        />
        {hoveredNodeId && hoverPoint && <div className="graph-hover-tip" style={{ left: hoverPoint.x + 14, top: hoverPoint.y - 10 }}>
          {(() => {
            const incoming = topInfluenceForNode(hoveredNodeId, 'in', 2)
            const outcoming = topInfluenceForNode(hoveredNodeId, 'out', 2)
            return <span>Узел: {METRICS.find((m) => m.id === hoveredNodeId)?.labelRu} • Влияет: {outcoming.map((e) => METRICS.find((m) => m.id === e.to)?.labelRu).join(', ') || 'нет'} • Получает: {incoming.map((e) => METRICS.find((m) => m.id === e.from)?.labelRu).join(', ') || 'нет'}</span>
          })()}
        </div>}
      </div>}

      {mode === 'matrix' && <table className="table table--dense"><thead><tr><th>От \ К</th>{metricIds.map((id) => <th key={id}>{METRICS.find((m) => m.id === id)?.labelRu}</th>)}</tr></thead>
        <tbody>{metricIds.map((fromId) => <tr key={fromId}><td>{METRICS.find((m) => m.id === fromId)?.labelRu}</td>{metricIds.map((toId) => {
          const weight = activeMatrix[fromId]?.[toId] ?? 0
          return <td key={toId}><button type="button" className="heat-cell" style={{ background: `rgba(${weight > 0 ? '67,243,208' : '192,132,252'}, ${Math.abs(weight)})` }} onClick={() => {
            setSelectedEdge({ from: fromId, to: toId })
            if (weight !== 0) {
              setMode('map')
              setFocusRequest({ edge: { from: fromId, to: toId } })
            }
          }}>{weight.toFixed(1)}</button></td>
        })}</tr>)}</tbody></table>}
    </div>

    <aside className="inspector panel">
      <h2>{selectedNodeId ? 'Инспектор узла' : 'Инспектор связи'}</h2>
      {selectedNodeId && <>
        <p><strong>{selectedNodeLabel}</strong></p>
        <p>Центральность (вход/выход/сумма): {topInfluenceForNode(selectedNodeId, 'in', 99).reduce((sum, edge) => sum + Math.abs(edge.weight), 0).toFixed(2)} / {topInfluenceForNode(selectedNodeId, 'out', 99).reduce((sum, edge) => sum + Math.abs(edge.weight), 0).toFixed(2)} / {(topInfluenceForNode(selectedNodeId, 'in', 99).reduce((sum, edge) => sum + Math.abs(edge.weight), 0) + topInfluenceForNode(selectedNodeId, 'out', 99).reduce((sum, edge) => sum + Math.abs(edge.weight), 0)).toFixed(2)}</p>
        <p><strong>Входящее влияние (топ-3):</strong> {topInfluenceForNode(selectedNodeId, 'in', 3).map((edge) => `${METRICS.find((m) => m.id === edge.from)?.labelRu} (${edge.weight > 0 ? '+' : ''}${edge.weight.toFixed(2)})`).join('; ') || 'нет'}</p>
        <p><strong>Исходящее влияние (топ-3):</strong> {topInfluenceForNode(selectedNodeId, 'out', 3).map((edge) => `${METRICS.find((m) => m.id === edge.to)?.labelRu} (${edge.weight > 0 ? '+' : ''}${edge.weight.toFixed(2)})`).join('; ') || 'нет'}</p>
        <div className="graph-summary__actions">
          <button type="button" className="chip" onClick={() => triggerImpulseCheck(selectedNodeId, 1)}>Проверить импульсом</button>
          <button type="button" className="chip" onClick={() => {
            const edge = topInfluenceForNode(selectedNodeId, 'out', 1)[0]
            if (edge) applyEdgeAsScenario(edge.from, edge.to, edge.weight)
          }}>Применить как сценарий</button>
        </div>
      </>}
      {!selectedNodeId && !selectedEdge ? <p>Выберите связь на карте или в матрице.</p> : null}
      {!selectedNodeId && selectedEdge ? <>
        <p><strong>{METRICS.find((m) => m.id === selectedEdge.from)?.labelRu}</strong> → <strong>{METRICS.find((m) => m.id === selectedEdge.to)?.labelRu}</strong></p>
        <p>Знак: {selectedWeight >= 0 ? 'положительный' : 'отрицательный'}</p>
        <p>Вес: {selectedWeight >= 0 ? '+' : ''}{selectedWeight.toFixed(2)}</p>
        <p>Ручной: {selectedManualWeight >= 0 ? '+' : ''}{selectedManualWeight.toFixed(2)}</p>
        <p>Из данных: {selectedLearnedWeight >= 0 ? '+' : ''}{selectedLearnedWeight.toFixed(2)}</p>
        <p>Уверенность: {selectedStability.toFixed(2)} — {stabilityLabel(selectedStability)}</p>
        <p>Смысл: {edgeMeaning({ from: selectedEdge.from, to: selectedEdge.to, weight: selectedWeight, absWeight: Math.abs(selectedWeight) })}</p>
      </> : null}
      {!selectedNodeId && !selectedEdge && hoveredEdge ? <p>Наведено: {METRICS.find((m) => m.id === hoveredEdge.from)?.labelRu} → {METRICS.find((m) => m.id === hoveredEdge.to)?.labelRu}</p> : null}
    </aside></div>}
    {helpOpen && <div className="graph-help-sheet" role="dialog" aria-modal="true" aria-label="Справка: граф влияний">
      <div className="graph-help-sheet__backdrop" onClick={() => setHelpOpen(false)} />
      <aside className="graph-help-sheet__panel panel">
        <div className="graph-help-sheet__header">
          <h2>Справка для новичка</h2>
          <button type="button" className="chip" onClick={() => setHelpOpen(false)}>Закрыть</button>
        </div>
        <section>
          <h3>1) Что здесь показано</h3>
          <p><strong>Узлы</strong> — это ваши метрики (сон, стресс, энергия и т.д.).</p>
          <p><strong>Связи</strong> показывают, как одна метрика влияет на другую.</p>
          <p><strong>Знак “+”</strong> значит «усиливает», <strong>знак “−”</strong> значит «ослабляет».</p>
          <p><strong>Толщина линии</strong> = сила влияния: чем толще, тем заметнее эффект.</p>
        </section>
        <section>
          <h3>2) Как двигаться по карте</h3>
          <ul>
            <li>Зажмите ЛКМ (или палец) и двигайте — вращение.</li>
            <li>Колесо мыши / щипок — приближение и отдаление.</li>
            <li>Клик по узлу или связи — выбрать и открыть детали справа.</li>
            <li>Кнопки «Подогнать вид», «Сброс вида», «Заморозить» помогают быстро навести порядок.</li>
          </ul>
        </section>
        <section>
          <h3>3) Что значит «Источник весов»</h3>
          <p><strong>Ручной</strong> — веса задаются вами вручную.</p>
          <p><strong>Из данных</strong> — веса рассчитаны автоматически по истории чек-инов.</p>
          <p><strong>Смешанный</strong> — комбинация ручного и из данных, долю выбираете ползунком.</p>
        </section>
        <section>
          <h3>4) Быстрый сценарий работы</h3>
          <ol>
            <li>Выберите узел (метрику), который хотите улучшить.</li>
            <li>Посмотрите топ входящих/исходящих влияний в инспекторе.</li>
            <li>Запустите «Проверить импульсом», чтобы увидеть прогноз сдвига.</li>
            <li>Если результат полезный — нажмите «Применить как сценарий».</li>
            <li>Нажмите «Прогнать в Мультивселенную», чтобы проверить ветки будущих исходов.</li>
          </ol>
        </section>
        <section>
          <h3>5) Если граф пустой или «разъехался»</h3>
          <ul>
            <li>Уменьшите порог фильтра или сбросьте быстрые пресеты.</li>
            <li>Нажмите «Подогнать вид» или «Сброс вида».</li>
            <li>Переключитесь на «Матрица», чтобы проверить, что связи действительно есть.</li>
            <li>Для режима «Из данных» сначала выполните «Обучить по данным».</li>
          </ul>
        </section>
      </aside>
    </div>}
  </section>
}
