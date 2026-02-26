import { useMemo, useState } from 'react'
import { METRICS, type MetricId } from '../core/metrics'
import type { CheckinRecord } from '../core/models/checkin'
import type { InfluenceEdge } from '../core/engines/influence/influence'
import type { InfluenceMatrix, MetricVector } from '../core/engines/influence/types'
import { SparkButton } from '../ui/SparkButton'
import {
  computeCentralityMetrics,
  computeEarlyWarningSignals,
  computeInfluenceConcentration,
  computeRobustnessScore,
} from './leversMonitor'

interface LeverGroup {
  metric: MetricId
  score: number
  edges: InfluenceEdge[]
}

interface LeversDecisionViewProps {
  primaryLever?: LeverGroup
  alternatives: LeverGroup[]
  allLevers: LeverGroup[]
  forecastForMetric: (metric: MetricId, impulse?: number, stepOverride?: 1 | 2 | 3) => Array<{ id: MetricId; label: string; delta: number }>
  triggerImpulseCheck: (metric: MetricId, value: number) => void
  applyEdgeAsScenario: (from: MetricId, to: MetricId, weight: number) => void
  search: string
  setSearch: (value: string) => void
  source: MetricId | 'all'
  setSource: (value: MetricId | 'all') => void
  target: MetricId | 'all'
  setTarget: (value: MetricId | 'all') => void
  sign: 'all' | 'positive' | 'negative'
  setSign: (value: 'all' | 'positive' | 'negative') => void
  threshold: number
  setThreshold: (value: number) => void
  topN: number
  setTopN: (value: number) => void
  quickPreset: 'none' | 'strong' | 'positive' | 'negative' | 'confidence'
  applyQuickPreset: (preset: 'none' | 'strong' | 'positive' | 'negative' | 'confidence') => void
  visibleEdges: InfluenceEdge[]
  selectedEdge: { from: MetricId; to: MetricId } | null
  setSelectedEdge: (edge: { from: MetricId; to: MetricId }) => void
  stabilityLabel: (score: number) => string
  stabilityMatrix: InfluenceMatrix
  learnedMatrix: InfluenceMatrix
  edgeMeaning: (edge: InfluenceEdge) => string
  steps: 1 | 2 | 3
  runRecompute: () => void
  clearLearned: () => void
  selectedManualWeight: number
  selectedLearnedWeight: number
  selectedWeight: number
  selectedStability: number
  manualMatrix: InfluenceMatrix
  setManualMatrix: (updater: (prev: InfluenceMatrix) => InfluenceMatrix) => void
  saveManual: () => void
  resetManual: () => void
  impulseMetric: MetricId
  setImpulseMetric: (value: MetricId) => void
  delta: number
  setDelta: (value: number) => void
  setSteps: (value: 1 | 2 | 3) => void
  runImpulseTest: (metric: MetricId, value: number) => void
  runInMultiverse: (metric: MetricId, value: number) => void
  testResult: MetricVector | null
  lastCheckSummary: string | null
  mapAvailable: boolean
  openMap: () => void
  checkins: CheckinRecord[]
}

const DETAILS_OPEN_KEY = 'graph:accordion:details'
const LAB_OPEN_KEY = 'graph:accordion:lab'
const MONITOR_METRICS_KEY = 'graph:monitor:metrics'

const readOpenFlag = (key: string, fallback = false) => {
  const raw = window.localStorage.getItem(key)
  if (!raw) return fallback
  return raw === '1'
}

const parseMonitoredMetrics = (): MetricId[] => {
  const fallback: MetricId[] = ['sleepHours', 'energy', 'stress']
  const raw = window.localStorage.getItem(MONITOR_METRICS_KEY)
  if (!raw) return fallback
  try {
    const parsed = JSON.parse(raw) as MetricId[]
    const valid = parsed.filter((item): item is MetricId => METRICS.some((metric) => metric.id === item)).slice(0, 3)
    return valid.length === 3 ? valid : fallback
  } catch {
    return fallback
  }
}

function getReliabilityLabel(lever: LeverGroup, stabilityMatrix: InfluenceMatrix, learnedMatrix: InfluenceMatrix): string {
  const topEdges = lever.edges.slice(0, 3)
  const knownConfidence = topEdges
    .map((edge) => stabilityMatrix[edge.from]?.[edge.to] ?? 0)
    .filter((value) => value > 0)
  if (knownConfidence.length > 0) {
    const avgConfidence = knownConfidence.reduce((sum, value) => sum + value, 0) / knownConfidence.length
    if (avgConfidence >= 0.7) return 'Высокая'
    if (avgConfidence >= 0.4) return 'Средняя'
    return 'Низкая'
  }

  const avgAbsWeight = topEdges.reduce((sum, edge) => sum + Math.abs(edge.weight), 0) / Math.max(topEdges.length, 1)
  const hasLearnedEdge = topEdges.some((edge) => Math.abs(learnedMatrix[edge.from]?.[edge.to] ?? 0) > 0.05)
  if (avgAbsWeight >= 0.55 && hasLearnedEdge) return 'Высокая'
  if (avgAbsWeight >= 0.3 || hasLearnedEdge) return 'Средняя'
  return 'Низкая'
}

export function LeversDecisionView(props: LeversDecisionViewProps) {
  const {
    primaryLever,
    alternatives,
    allLevers,
    forecastForMetric,
    triggerImpulseCheck,
    applyEdgeAsScenario,
    search,
    setSearch,
    source,
    setSource,
    target,
    setTarget,
    sign,
    setSign,
    threshold,
    setThreshold,
    topN,
    setTopN,
    quickPreset,
    applyQuickPreset,
    visibleEdges,
    selectedEdge,
    setSelectedEdge,
    stabilityLabel,
    stabilityMatrix,
    learnedMatrix,
    edgeMeaning,
    steps,
    runRecompute,
    clearLearned,
    selectedManualWeight,
    selectedLearnedWeight,
    selectedWeight,
    selectedStability,
    manualMatrix,
    setManualMatrix,
    saveManual,
    resetManual,
    impulseMetric,
    setImpulseMetric,
    delta,
    setDelta,
    setSteps,
    runImpulseTest,
    runInMultiverse,
    testResult,
    lastCheckSummary,
    mapAvailable,
    openMap,
    checkins,
  } = props

  const [detailsOpen, setDetailsOpen] = useState(() => readOpenFlag(DETAILS_OPEN_KEY, true))
  const [labOpen, setLabOpen] = useState(() => readOpenFlag(LAB_OPEN_KEY, false))
  const [selectedLeverMetric, setSelectedLeverMetric] = useState<MetricId | null>(primaryLever?.metric ?? null)
  const [autoPickMessage, setAutoPickMessage] = useState('')
  const [monitorMetrics, setMonitorMetrics] = useState<MetricId[]>(() => parseMonitoredMetrics())
  const [highlightMetrics, setHighlightMetrics] = useState<MetricId[]>([])
  const [showResilienceFormula, setShowResilienceFormula] = useState(false)

  const advisorLever = useMemo(() => {
    if (!selectedLeverMetric) return primaryLever
    return allLevers.find((lever) => lever.metric === selectedLeverMetric) ?? primaryLever
  }, [allLevers, primaryLever, selectedLeverMetric])

  const rationaleEdges = advisorLever?.edges.slice(0, 3) ?? []
  const reliabilityLabel = advisorLever ? getReliabilityLabel(advisorLever, stabilityMatrix, learnedMatrix) : null
  const centrality = useMemo(() => computeCentralityMetrics(visibleEdges), [visibleEdges])
  const concentration = useMemo(() => computeInfluenceConcentration(centrality.centralityByMetric), [centrality])
  const robustnessScore = useMemo(
    () => computeRobustnessScore(visibleEdges, centrality.topCentrality.map((entry) => entry.metric)),
    [centrality, visibleEdges],
  )
  const riskSignals = useMemo(() => computeEarlyWarningSignals(checkins, monitorMetrics, 14), [checkins, monitorMetrics])

  const sideEffectWarning = useMemo(() => {
    if (!advisorLever) return null
    const firstWave = forecastForMetric(advisorLever.metric, 1, 1)
    const secondWave = forecastForMetric(advisorLever.metric, 1, 2)
    const secondOrder = secondWave
      .map((effect) => {
        const stepOne = firstWave.find((row) => row.id === effect.id)?.delta ?? 0
        return { ...effect, secondOrderDelta: effect.delta - stepOne }
      })
      .sort((a, b) => a.secondOrderDelta - b.secondOrderDelta)

    const negative = secondOrder.find((effect) => effect.secondOrderDelta < 0)
    if (negative) {
      return `На второй волне может просесть «${negative.label}» (${negative.secondOrderDelta.toFixed(1)}).`
    }

    const uncertainEdge = advisorLever.edges
      .map((edge) => ({ edge, confidence: stabilityMatrix[edge.from]?.[edge.to] ?? 0 }))
      .sort((a, b) => a.confidence - b.confidence)[0]
    if (uncertainEdge) {
      const label = METRICS.find((m) => m.id === uncertainEdge.edge.to)?.labelRu ?? uncertainEdge.edge.to
      return `Есть неопределённость по влиянию на «${label}» (уверенность ${uncertainEdge.confidence.toFixed(2)}).`
    }

    return 'Побочные эффекты не выражены, но наблюдайте метрики после проверки.'
  }, [advisorLever, forecastForMetric, stabilityMatrix])

  const openDetailsFor = (metrics: MetricId[]) => {
    setDetailsOpen(true)
    window.localStorage.setItem(DETAILS_OPEN_KEY, '1')
    setHighlightMetrics(metrics)
    window.setTimeout(() => {
      document.querySelector('.graph-accordion')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 30)
  }

  const handleMonitorMetricChange = (index: number, value: MetricId) => {
    const next = [...monitorMetrics]
    next[index] = value
    setMonitorMetrics(next)
    window.localStorage.setItem(MONITOR_METRICS_KEY, JSON.stringify(next))
  }

  const runAutoPick = () => {
    if (allLevers.length === 0) {
      setAutoPickMessage('Не найдено кандидатов. Попробуйте снизить порог силы, включить «Смешанный» источник или добавить свежий чек-ин.')
      return
    }
    setSelectedLeverMetric(allLevers[0].metric)
    setAutoPickMessage(`Подобран рычаг: ${METRICS.find((m) => m.id === allLevers[0].metric)?.labelRu ?? allLevers[0].metric}.`)
  }

  const bottlenecks = [
    { title: 'Драйверы', hint: 'больше всего влияет', items: centrality.topOutdegree },
    { title: 'Уязвимые', hint: 'больше всего получает', items: centrality.topIndegree },
    { title: 'Критические', hint: 'ключевой узел', items: centrality.topCentrality },
  ]

  return <div className="levers-decision">
    <section className="graph-summary panel">
      <h2>Лучший рычаг сейчас</h2>
      {!advisorLever ? <>
        <p>По текущим условиям рычаги не найдены. Ослабьте фильтры.</p>
        <button type="button" className="chip" onClick={runAutoPick}>Найти лучший рычаг автоматически</button>
        {autoPickMessage && <p className="graph-meta-hint">{autoPickMessage}</p>}
      </> : <>
        <p className="graph-summary__lead">Если улучшить <strong>{METRICS.find((m) => m.id === advisorLever.metric)?.labelRu ?? advisorLever.metric}</strong> на +1, сильнее всего изменится: {forecastForMetric(advisorLever.metric).slice(0, 2).map((item) => `${item.label} (${item.delta >= 0 ? '+' : ''}${item.delta.toFixed(1)})`).join(', ')}.</p>
        <ul className="graph-summary__effects">
          {forecastForMetric(advisorLever.metric).map((effect) => <li key={effect.id}>{effect.label}: {effect.delta >= 0 ? '+' : ''}{effect.delta.toFixed(1)}</li>)}
        </ul>
        <div className="graph-summary__actions">
          <button type="button" className="chip" onClick={() => triggerImpulseCheck(advisorLever.metric, 1)}>Запустить проверку</button>
          <button type="button" className="chip" onClick={() => applyEdgeAsScenario(advisorLever.metric, advisorLever.edges[0].to, advisorLever.edges[0].weight)}>Применить как сценарий</button>
          <button type="button" className="chip" title="Открыть симуляцию Мультивселенной с текущим импульсом" onClick={() => runInMultiverse(advisorLever.metric, delta)}>Прогнать в Мультивселенную</button>
          <button type="button" className="chip" onClick={runAutoPick}>Найти лучший рычаг автоматически</button>
        </div>
        {autoPickMessage && <p className="graph-meta-hint">{autoPickMessage}</p>}
        {lastCheckSummary && <p className="graph-summary__check"><strong>Проверка:</strong> {lastCheckSummary}</p>}

        <div className="graph-interpreter">
          <h3>Интерпретатор</h3>
          <p><strong>Почему система так считает:</strong></p>
          <ul>
            {rationaleEdges.map((edge) => <li key={`${edge.from}-${edge.to}`}>{METRICS.find((m) => m.id === edge.from)?.labelRu} → {METRICS.find((m) => m.id === edge.to)?.labelRu}: {edge.weight >= 0 ? '+' : ''}{edge.weight.toFixed(2)}</li>)}
          </ul>
          <p><strong>Возможная побочка:</strong> {sideEffectWarning}</p>
          <p><strong>Надёжность подсказки:</strong> {reliabilityLabel}</p>
        </div>
      </>}
    </section>

    <section className="graph-monitor-row">
      <article className="panel graph-monitor-card">
        <h3>Узкие места</h3>
        <ul>
          {bottlenecks.map((block) => <li key={block.title}><strong>{block.title}:</strong> {(block.items[0] ? METRICS.find((m) => m.id === block.items[0].metric)?.labelRu : '—') ?? '—'} — {block.hint}.</li>)}
        </ul>
        <button type="button" className="chip" onClick={() => (mapAvailable ? openMap() : openDetailsFor(centrality.topCentrality.map((item) => item.metric)))}>{mapAvailable ? 'Показать на карте' : 'Открыть детали'}</button>
      </article>

      <article className="panel graph-monitor-card">
        <h3>Сигналы риска</h3>
        <div className="graph-monitor-settings">
          {monitorMetrics.map((metric, index) => <select key={`${metric}-${index}`} value={metric} onChange={(event) => handleMonitorMetricChange(index, event.target.value as MetricId)}>{METRICS.map((item) => <option key={item.id} value={item.id}>{item.labelRu}</option>)}</select>)}
        </div>
        {!riskSignals.enoughData ? <p>Недостаточно данных: {riskSignals.current}/{riskSignals.required} чек-инов. Сделайте чек-ин.</p> : <>
          <p><strong>{riskSignals.level}</strong></p>
          <ul>{riskSignals.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>
          <p className="graph-meta-hint">Это статистические признаки, не гарантия кризиса.</p>
        </>}
        <button type="button" className="chip" onClick={() => openDetailsFor(monitorMetrics)}>Подробнее</button>
      </article>

      <article className="panel graph-monitor-card">
        <h3>Устойчивость</h3>
        <p><strong>Концентрация:</strong> {concentration.label} (топ-1: {(concentration.top1Share * 100).toFixed(0)}%, топ-3: {(concentration.top3Share * 100).toFixed(0)}%).</p>
        <p><strong>Устойчивость:</strong> {robustnessScore.toFixed(2)}</p>
        <button type="button" className="chip" onClick={() => setShowResilienceFormula((value) => !value)}>Как считается?</button>
        {showResilienceFormula && <p className="graph-meta-hint">Берём 1–3 самых центральных узла, по очереди убираем их и считаем долю узлов в крупнейшей связной части. Среднее и есть оценка устойчивости.</p>}
      </article>
    </section>

    <section>
      <h2>Альтернативы</h2>
      <div className="graph-top3">
        {alternatives.map((lever) => {
          const forecast = forecastForMetric(lever.metric)[0]
          return <article key={lever.metric} className="graph-top3__card panel">
            <h3>{METRICS.find((m) => m.id === lever.metric)?.labelRu ?? lever.metric}</h3>
            <p>{forecast ? `${forecast.label}: ${forecast.delta >= 0 ? '+' : ''}${forecast.delta.toFixed(1)}` : 'Недостаточно данных для оценки.'}</p>
            <button type="button" className="chip" onClick={() => triggerImpulseCheck(lever.metric, 1)}>Проверить</button>
          </article>
        })}
      </div>
    </section>

    <details className="panel graph-accordion" open={detailsOpen} onToggle={(event) => {
      const open = event.currentTarget.open
      setDetailsOpen(open)
      window.localStorage.setItem(DETAILS_OPEN_KEY, open ? '1' : '0')
    }}>
      <summary>Детали карты ({visibleEdges.length} связей · фильтры активны)</summary>
      <div className="filters graph-filters">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск по метрике" />
        <select value={source} onChange={(e) => setSource(e.target.value as MetricId | 'all')}><option value="all">Источник: все</option>{METRICS.map((m) => <option key={m.id} value={m.id}>{m.labelRu}</option>)}</select>
        <select value={target} onChange={(e) => setTarget(e.target.value as MetricId | 'all')}><option value="all">Цель: все</option>{METRICS.map((m) => <option key={m.id} value={m.id}>{m.labelRu}</option>)}</select>
        <select value={sign} onChange={(e) => setSign(e.target.value as 'all' | 'positive' | 'negative')}><option value="all">Любой знак</option><option value="positive">Только +</option><option value="negative">Только −</option></select>
        <label>Сила связи ≥ <input type="number" step={0.05} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} /></label>
        <label>Топ связей <input type="number" min={1} max={40} value={topN} onChange={(e) => setTopN(Number(e.target.value))} /></label>
        <SparkButton type="button" onClick={runRecompute}>Переобучить</SparkButton>
        <button type="button" onClick={clearLearned}>Очистить карту из данных</button>
      </div>
      <div className="preset-row">
        <button type="button" className={quickPreset === 'strong' ? 'filter-button filter-button--active' : 'filter-button'} onClick={() => applyQuickPreset('strong')}>Сильные</button>
        <button type="button" className={quickPreset === 'positive' ? 'filter-button filter-button--active' : 'filter-button'} onClick={() => applyQuickPreset('positive')}>Только +</button>
        <button type="button" className={quickPreset === 'negative' ? 'filter-button filter-button--active' : 'filter-button'} onClick={() => applyQuickPreset('negative')}>Только −</button>
        <button type="button" className={quickPreset === 'confidence' ? 'filter-button filter-button--active' : 'filter-button'} onClick={() => applyQuickPreset('confidence')}>Высокая уверенность</button>
        <button type="button" className={quickPreset === 'none' ? 'filter-button filter-button--active' : 'filter-button'} onClick={() => applyQuickPreset('none')}>Сброс</button>
      </div>
      <div className="graph-table-wrap">
        <table className="table table--dense"><thead><tr><th>От</th><th>К</th><th>Сила связи</th><th>Уверенность</th><th>Волны влияния (не дни)</th><th>Смысл</th><th>Действие</th></tr></thead>
          <tbody>{visibleEdges.map((edge) => {
            const stability = stabilityMatrix[edge.from]?.[edge.to] ?? 0
            const rowHighlight = highlightMetrics.includes(edge.from) || highlightMetrics.includes(edge.to)
            return <tr key={`${edge.from}-${edge.to}`} onClick={() => setSelectedEdge({ from: edge.from, to: edge.to })} className={`${selectedEdge?.from === edge.from && selectedEdge?.to === edge.to ? 'row-active' : ''} ${rowHighlight ? 'row-monitor-focus' : ''}`}><td>{METRICS.find((m) => m.id === edge.from)?.labelRu}</td><td>{METRICS.find((m) => m.id === edge.to)?.labelRu}</td><td>{edge.weight > 0 ? '+' : ''}{edge.weight.toFixed(2)}<div className="graph-meta-hint">Сила связи: насколько одно изменение тянет другое.</div></td><td>{stabilityLabel(stability)} ({stability.toFixed(2)})</td><td>{steps}</td><td>{edgeMeaning(edge)}</td><td><button type="button" className="chip" onClick={(event) => { event.stopPropagation(); triggerImpulseCheck(edge.from, edge.weight >= 0 ? 1 : -1) }}>Запустить проверку</button></td></tr>
          })}</tbody></table>
      </div>
    </details>

    <details className="panel graph-accordion" open={labOpen} onToggle={(event) => {
      const open = event.currentTarget.open
      setLabOpen(open)
      window.localStorage.setItem(LAB_OPEN_KEY, open ? '1' : '0')
    }}>
      <summary>Лаборатория (3 инструмента · инспектор и проверка)</summary>
      <div className="inspector-in-panel">
        <h3>Инспектор связи</h3>
        {!selectedEdge ? <p>Выберите связь в таблице.</p> : <>
          <p><strong>{METRICS.find((m) => m.id === selectedEdge.from)?.labelRu}</strong> → <strong>{METRICS.find((m) => m.id === selectedEdge.to)?.labelRu}</strong></p>
          <p>Ручной: {selectedManualWeight >= 0 ? '+' : ''}{selectedManualWeight.toFixed(2)}</p>
          <p>Из данных: {selectedLearnedWeight >= 0 ? '+' : ''}{selectedLearnedWeight.toFixed(2)}</p>
          <p>Смешанный: {selectedWeight >= 0 ? '+' : ''}{selectedWeight.toFixed(2)}</p>
          <p>Уверенность: {selectedStability.toFixed(2)} — {stabilityLabel(selectedStability)}</p>
          <input type="range" min={-1} max={1} step={0.05} value={manualMatrix[selectedEdge.from]?.[selectedEdge.to] ?? 0} onChange={(e) => setManualMatrix((prev) => ({ ...prev, [selectedEdge.from]: { ...prev[selectedEdge.from], [selectedEdge.to]: Number(e.target.value) } }))} />
        </>}
        <div className="settings-actions">
          <SparkButton type="button" onClick={saveManual}>Сохранить ручную карту</SparkButton>
          <SparkButton type="button" onClick={resetManual}>Сбросить ручную карту</SparkButton>
        </div>
      </div>

      <div>
        <h3>Проверка импульса</h3>
        <p className="graph-meta-hint">Волны влияния (не дни).</p>
        <label>Метрика<select value={impulseMetric} onChange={(e) => setImpulseMetric(e.target.value as MetricId)}>{METRICS.map((m) => <option key={m.id} value={m.id}>{m.labelRu}</option>)}</select></label>
        <label>Изменение Δ<input type="number" value={delta} onChange={(e) => setDelta(Number(e.target.value))} /></label>
        <label>Волны влияния (не дни)<select value={steps} onChange={(e) => setSteps(Number(e.target.value) as 1 | 2 | 3)}>{[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
        <SparkButton type="button" onClick={() => runImpulseTest(impulseMetric, delta)}>Запустить проверку</SparkButton>
        {testResult && <p>Результат: {METRICS.map((m) => `${m.labelRu}: ${testResult[m.id].toFixed(1)}`).join(' | ')}</p>}
      </div>
    </details>
  </div>
}
