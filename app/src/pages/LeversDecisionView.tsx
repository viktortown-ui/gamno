import { METRICS, type MetricId } from '../core/metrics'
import type { InfluenceEdge } from '../core/engines/influence/influence'
import type { InfluenceMatrix, MetricVector } from '../core/engines/influence/types'
import { SparkButton } from '../ui/SparkButton'

interface LeverGroup {
  metric: MetricId
  score: number
  edges: InfluenceEdge[]
}

interface LeversDecisionViewProps {
  primaryLever?: LeverGroup
  alternatives: LeverGroup[]
  forecastForMetric: (metric: MetricId, impulse?: number) => Array<{ id: MetricId; label: string; delta: number }>
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
  testResult: MetricVector | null
}

export function LeversDecisionView(props: LeversDecisionViewProps) {
  const {
    primaryLever,
    alternatives,
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
    testResult,
  } = props

  return <div className="levers-decision">
    <section className="graph-summary panel">
      <h2>Лучший рычаг сейчас</h2>
      {!primaryLever ? <p>По текущим условиям рычаги не найдены. Ослабьте фильтры.</p> : <>
        <p className="graph-summary__lead">Если улучшить <strong>{METRICS.find((m) => m.id === primaryLever.metric)?.labelRu ?? primaryLever.metric}</strong> на +1, сильнее всего изменится: {forecastForMetric(primaryLever.metric).slice(0, 2).map((item) => `${item.label} (${item.delta >= 0 ? '+' : ''}${item.delta.toFixed(1)})`).join(', ')}.</p>
        <ul className="graph-summary__effects">
          {forecastForMetric(primaryLever.metric).map((effect) => <li key={effect.id}>{effect.label}: {effect.delta >= 0 ? '+' : ''}{effect.delta.toFixed(1)}</li>)}
        </ul>
        <div className="graph-summary__actions">
          <button type="button" className="chip" onClick={() => triggerImpulseCheck(primaryLever.metric, 1)}>Запустить проверку</button>
          <button type="button" className="chip" onClick={() => applyEdgeAsScenario(primaryLever.metric, primaryLever.edges[0].to, primaryLever.edges[0].weight)}>Применить как сценарий</button>
        </div>
        <details>
          <summary>Почему так?</summary>
          <ul>
            {primaryLever.edges.slice(0, 3).map((edge) => <li key={`${edge.from}-${edge.to}`}>{METRICS.find((m) => m.id === edge.from)?.labelRu} → {METRICS.find((m) => m.id === edge.to)?.labelRu}: {edge.weight >= 0 ? '+' : ''}{edge.weight.toFixed(2)}</li>)}
          </ul>
        </details>
      </>}
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

    <details className="panel graph-accordion">
      <summary>Детали карты</summary>
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
            return <tr key={`${edge.from}-${edge.to}`} onClick={() => setSelectedEdge({ from: edge.from, to: edge.to })} className={selectedEdge?.from === edge.from && selectedEdge?.to === edge.to ? 'row-active' : ''}><td>{METRICS.find((m) => m.id === edge.from)?.labelRu}</td><td>{METRICS.find((m) => m.id === edge.to)?.labelRu}</td><td>{edge.weight > 0 ? '+' : ''}{edge.weight.toFixed(2)}<div className="graph-meta-hint">Сила связи: насколько одно изменение тянет другое.</div></td><td>{stabilityLabel(stability)} ({stability.toFixed(2)})</td><td>{steps}</td><td>{edgeMeaning(edge)}</td><td><button type="button" className="chip" onClick={(event) => { event.stopPropagation(); triggerImpulseCheck(edge.from, edge.weight >= 0 ? 1 : -1) }}>Запустить проверку</button></td></tr>
          })}</tbody></table>
      </div>
    </details>

    <details className="panel graph-accordion">
      <summary>Лаборатория</summary>
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
