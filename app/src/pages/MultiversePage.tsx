import { useEffect, useMemo, useRef, useState } from 'react'
import { METRICS, type MetricId } from '../core/metrics'
import type { CheckinRecord } from '../core/models/checkin'
import type { OracleScenarioDraft, WeightsSource } from '../core/engines/influence/types'
import type { MultiverseConfig, MultiverseRunResult, PlannedImpulse } from '../core/engines/multiverse/types'
import { computeIndexDay, computeIndexSeries, computeVolatility } from '../core/engines/analytics/compute'
import { getTransitionMatrix, buildRegimeSeriesFromCheckins } from '../core/regime/model'
import { assessCollapseRisk } from '../core/collapse/model'
import { resolveActiveMatrix } from '../core/engines/influence/weightsSource'
import { FanChart } from '../ui/components/FanChart'
import { formatDateTime } from '../ui/format'
import { addQuest, getActiveGoal, getLearnedMatrix, listCheckins, listScenarios, loadInfluenceMatrix } from '../core/storage/repo'
import { getLatestForecastRun } from '../repo/forecastRepo'
import { getLastMultiverseRun, saveMultiverseRun } from '../repo/multiverseRepo'
import { cancelMultiverseWorker, createMultiverseWorker, runMultiverseInWorker } from '../core/workers/multiverseClient'

function mapImpulses(impulses: Partial<Record<MetricId, number>>, day = 0): PlannedImpulse[] {
  return Object.entries(impulses).map(([metricId, delta]) => ({ day, metricId: metricId as MetricId, delta: Number(delta ?? 0) }))
}

function readDraft(): OracleScenarioDraft | null {
  const raw = window.localStorage.getItem('gamno.oracleDraft')
  if (!raw) return null
  try { return JSON.parse(raw) as OracleScenarioDraft } catch { return null }
}

export function MultiversePage() {
  const [checkins, setCheckins] = useState<CheckinRecord[]>([])
  const [scenarios, setScenarios] = useState<Array<{ ts: number; nameRu: string; impulses: Partial<Record<MetricId, number>> }>>([])
  const [selectedBase, setSelectedBase] = useState<'latest' | number>('latest')
  const [selectedPlan, setSelectedPlan] = useState<'draft' | number>('draft')
  const [source, setSource] = useState<WeightsSource>('mixed')
  const [horizonDays, setHorizonDays] = useState<7 | 14 | 30 | 60>(14)
  const [runs, setRuns] = useState<1000 | 5000 | 10000 | 25000>(10000)
  const [seed, setSeed] = useState(42)
  const [shockMode, setShockMode] = useState<'off' | 'normal' | 'blackSwan'>('normal')
  const [collapseConstraintPct, setCollapseConstraintPct] = useState(20)
  const [indexFloor, setIndexFloor] = useState(40)
  const [manualMetric, setManualMetric] = useState<MetricId>('sleepHours')
  const [manualDelta, setManualDelta] = useState(0.3)
  const [result, setResult] = useState<MultiverseRunResult | null>(null)
  const [baselineResult, setBaselineResult] = useState<MultiverseRunResult | null>(null)
  const [selectedPath, setSelectedPath] = useState<'probable' | 'best' | 'worst'>('probable')
  const [selectedPathIndex, setSelectedPathIndex] = useState(0)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const workerRef = useRef<Worker | null>(null)

  async function loadRuntime(sourceMode: WeightsSource) {
    const [manualMatrix, learned, forecastRun, activeGoal] = await Promise.all([loadInfluenceMatrix(), getLearnedMatrix(), getLatestForecastRun(), getActiveGoal()])
    const effectiveSource: WeightsSource = sourceMode === 'learned' && !learned ? 'manual' : sourceMode
    const matrix = resolveActiveMatrix(effectiveSource, manualMatrix, learned?.weights ?? manualMatrix, 0.5)
    const residualStd = forecastRun?.residualStats.std ?? 0.8
    const residuals = Array.from({ length: 81 }, (_, index) => Number((((index - 40) / 10) * residualStd).toFixed(4)))
    return {
      matrix,
      stability: learned?.stability,
      weightsSource: effectiveSource,
      mix: effectiveSource === 'mixed' ? 0.5 : 0,
      residuals,
      audit: { forecastModelType: forecastRun?.modelType, lags: learned?.meta.lags, trainedOnDays: learned?.meta.trainedOnDays },
      goalWeights: activeGoal?.weights,
      activeGoal,
    }
  }

  useEffect(() => {
    let cancelled = false
    void Promise.all([listCheckins(), listScenarios(), getLastMultiverseRun()]).then(([rows, scenariosRows, last]) => {
      if (cancelled) return
      setCheckins(rows)
      setScenarios(scenariosRows.map((row) => ({ ts: row.ts, nameRu: row.nameRu, impulses: row.impulses })))
      if (last) setResult({ generatedAt: last.ts, config: last.config, quantiles: last.quantiles, tail: last.summary, samplePaths: last.samplePaths, representativeWorstPath: last.samplePaths.at(-1) ?? [], hedges: [], distributions: { horizonIndex: [] }, audit: last.audit, trajectoryExplorer: { probable: [], best: [], worst: [] }, regimeMap: { horizon: {}, next1: {}, next3: {} } } as MultiverseRunResult)
    })
    return () => { cancelled = true; workerRef.current?.terminate() }
  }, [])

  const baseline = useMemo(() => selectedBase === 'latest' ? checkins[0] : checkins.find((item) => item.ts === selectedBase) ?? checkins[0], [checkins, selectedBase])

  const plan = useMemo(() => {
    const draft = readDraft()
    if (selectedPlan === 'draft' && draft?.impulses) return { nameRu: draft.sourceLabelRu ?? 'Черновик Оракула', impulses: mapImpulses(draft.impulses, 0) }
    const scenario = scenarios.find((item) => item.ts === selectedPlan)
    if (scenario) return { nameRu: scenario.nameRu, impulses: mapImpulses(scenario.impulses, 0) }
    return { nameRu: 'Ручной импульс', impulses: [{ day: 0, metricId: manualMetric, delta: manualDelta }] as PlannedImpulse[] }
  }, [selectedPlan, scenarios, manualMetric, manualDelta])

  async function run(isBaseline = false) {
    if (!baseline) return
    const env = await loadRuntime(source)
    const dayIndexes = computeIndexSeries(checkins)
    const volatility = computeVolatility(checkins, 'energy', 14) * 50
    const regimeSeries = buildRegimeSeriesFromCheckins([...checkins].reverse(), dayIndexes, volatility)
    const transitionMatrix = getTransitionMatrix(regimeSeries)
    const baseIndex = computeIndexDay(baseline)
    const baseCollapse = assessCollapseRisk({ ts: baseline.ts, index: baseIndex, risk: Math.max(0, 10 - baseIndex), volatility, xp: 0, level: 0, entropy: 0, drift: 0, stats: { strength: baseline.health * 10, intelligence: baseline.focus * 10, wisdom: baseline.mood * 10, dexterity: baseline.energy * 10 } }, baseline)

    const config: MultiverseConfig = {
      horizonDays, runs, seed, indexFloor, collapseConstraintPct, shockMode,
      baseVector: baseline, baseIndex, basePCollapse: baseCollapse.pCollapse, baseRegime: regimeSeries.at(-1) ?? 0,
      matrix: env.matrix, learnedStability: env.stability, weightsSource: env.weightsSource, mix: env.mix,
      forecastResiduals: env.residuals, transitionMatrix,
      toggles: { forecastNoise: true, weightsNoise: true, stochasticRegime: true },
      plan: isBaseline ? { nameRu: 'Базовый без действий', impulses: [] } : plan,
      activeGoalWeights: env.goalWeights,
      audit: env.audit,
    }

    setRunning(true); setProgress({ done: 0, total: runs }); setError(null)
    workerRef.current?.terminate()
    workerRef.current = createMultiverseWorker((message) => {
      if (message.type === 'progress') setProgress({ done: message.done, total: message.total })
      if (message.type === 'error') { setError(message.message); setRunning(false) }
      if (message.type === 'done') {
        if (isBaseline) setBaselineResult(message.result)
        else setResult(message.result)
        setRunning(false)
      }
      if (message.type === 'cancelled') setRunning(false)
    })
    runMultiverseInWorker(workerRef.current, config)
  }

  async function acceptMission() {
    const activeGoal = await getActiveGoal()
    await addQuest({
      createdAt: Date.now(), title: 'Миссия из Мультивселенной (3 дня)', metricTarget: plan.impulses[0]?.metricId ?? 'energy', delta: plan.impulses[0]?.delta ?? 0.3,
      horizonDays: 3, status: 'active', predictedIndexLift: result?.tail.expectedDeltaIndex ?? 0, goalId: activeGoal?.id,
    })
    window.alert('План принят как миссия на 3 дня.')
  }

  const selectedCollection = result?.trajectoryExplorer[selectedPath] ?? []
  const selectedLine = selectedCollection[selectedPathIndex] ?? []

  return (
    <section className="page">
      <h1>Мультивселенная</h1>
      <div className="multiverse-grid">
        <article className="summary-card panel" onKeyDown={(e) => { if (e.key === 'Enter') void run(false) }}>
          <h2>Контур запуска</h2>
          <label>База
            <select value={selectedBase} onChange={(event) => setSelectedBase(event.target.value === 'latest' ? 'latest' : Number(event.target.value))}>
              <option value="latest">Последний check-in</option>
              {checkins.map((row) => <option key={row.ts} value={row.ts}>{formatDateTime(row.ts)}</option>)}
            </select>
          </label>
          <label>Источник влияний
            <select value={source} onChange={(event) => setSource(event.target.value as WeightsSource)}><option value="manual">Manual</option><option value="learned">Learned</option><option value="mixed">Mixed</option></select>
          </label>
          <label>Сценарий
            <select value={selectedPlan} onChange={(event) => setSelectedPlan(event.target.value === 'draft' ? 'draft' : Number(event.target.value))}>
              <option value="draft">Принять план из Оракула</option>
              {scenarios.map((row) => <option key={row.ts} value={row.ts}>{row.nameRu}</option>)}
              <option value={-1}>Ручной импульс</option>
            </select>
          </label>
          <label>Ручной импульс
            <div className="settings-actions"><select value={manualMetric} onChange={(e) => setManualMetric(e.target.value as MetricId)}>{METRICS.map((m) => <option key={m.id} value={m.id}>{m.labelRu}</option>)}</select><input type="number" step="0.1" value={manualDelta} onChange={(e) => setManualDelta(Number(e.target.value) || 0)} /></div>
          </label>
        </article>

        <article className="summary-card panel" onKeyDown={(e) => { if (e.key === 'Enter') void run(false) }}>
          <h2>Параметры</h2>
          <label>Horizon<select value={horizonDays} onChange={(event) => setHorizonDays(Number(event.target.value) as 7 | 14 | 30 | 60)}><option value={7}>7</option><option value={14}>14</option><option value={30}>30</option><option value={60}>60</option></select></label>
          <label>Runs<select value={runs} onChange={(event) => setRuns(Number(event.target.value) as 1000 | 5000 | 10000 | 25000)}><option value={1000}>1k</option><option value={5000}>5k</option><option value={10000}>10k</option><option value={25000}>25k</option></select></label>
          <label>Seed<input type="number" value={seed} onChange={(event) => setSeed(Number(event.target.value) || 0)} /></label>
          <label>Порог индекса<input type="number" value={indexFloor} onChange={(e) => setIndexFloor(Number(e.target.value) || 40)} /></label>
          <label>Shock mode<select value={shockMode} onChange={(e) => setShockMode(e.target.value as 'off' | 'normal' | 'blackSwan')}><option value="off">Off</option><option value="normal">Normal</option><option value="blackSwan">Black Swan</option></select></label>
          <label>держать P(collapse) ниже X%<input type="number" value={collapseConstraintPct} onChange={(e) => setCollapseConstraintPct(Math.max(1, Number(e.target.value) || 20))} /></label>
          <div className="settings-actions">
            <button type="button" onClick={() => run(false)} disabled={running || !baseline}>Пересчитать</button>
            <button type="button" onClick={() => run(true)} disabled={running || !baseline}>Baseline</button>
            <button type="button" onClick={() => { if (workerRef.current) cancelMultiverseWorker(workerRef.current); workerRef.current?.terminate(); setRunning(false) }} disabled={!running}>Остановить</button>
            <button type="button" onClick={acceptMission} disabled={!result}>Принять план как миссию на 3 дня</button>
          </div>
          {progress ? <p>Прогресс: {progress.done}/{progress.total}</p> : null}
          {error ? <p>{error}</p> : null}
        </article>

        <article className="summary-card panel">
          <h2>честность модели</h2>
          <p>Это вероятностная симуляция, не доказательство причинности. Learned-карта — статистическая.</p>
          <p>Прогнозы зависят от ваших данных и устойчивости режимов.</p>
          <button type="button" onClick={async () => { if (!result) return; await saveMultiverseRun({ ts: result.generatedAt, config: result.config, summary: result.tail, quantiles: result.quantiles, samplePaths: result.samplePaths, audit: result.audit }) }}>Сохранить прогон</button>
        </article>
      </div>

      {result ? <>
        <article className="summary-card panel"><h2>Распределение индекса (p10 / p50 / p90)</h2><FanChart labels={result.quantiles.days.map((day) => `Д${day}`)} p10={result.quantiles.index.p10} p50={result.quantiles.index.p50} p90={result.quantiles.index.p90} /></article>

        <div className="multiverse-grid">
          <article className="summary-card panel"><h2>Tail risk</h2><p>VaR 5% (loss Index): <strong>{result.tail.var5IndexLoss.toFixed(2)}</strong></p><p>CVaR 5% (loss Index): <strong>{result.tail.cvar5IndexLoss.toFixed(2)}</strong></p><p>VaR/CVaR P(collapse): <strong>{result.tail.var5Collapse.toFixed(3)} / {result.tail.cvar5Collapse.toFixed(3)}</strong></p><p>«средний ущерб в худших 5% исходов» = CVaR.</p></article>
          <article className="summary-card panel"><h2>Regime map</h2><p>Horizon: {Object.entries(result.regimeMap.horizon).map(([k, v]) => `R${k}: ${(v * 100).toFixed(1)}%`).join(' · ')}</p><p>next-1: {Object.entries(result.regimeMap.next1).map(([k, v]) => `R${k}: ${(v * 100).toFixed(1)}%`).join(' · ')}</p><p>next-3: {Object.entries(result.regimeMap.next3).map(([k, v]) => `R${k}: ${(v * 100).toFixed(1)}%`).join(' · ')}</p></article>
          <article className="summary-card panel"><h2>Δ распределения vs baseline</h2><p>Δ p50: {baselineResult ? (result.quantiles.index.p50.at(-1)! - baselineResult.quantiles.index.p50.at(-1)!).toFixed(2) : 'запустите Baseline'}</p><p>Δ p10: {baselineResult ? (result.quantiles.index.p10.at(-1)! - baselineResult.quantiles.index.p10.at(-1)!).toFixed(2) : '—'}</p><p>Δ CVaR(loss): {baselineResult ? (result.tail.cvar5IndexLoss - baselineResult.tail.cvar5IndexLoss).toFixed(2) : '—'}</p></article>
        </div>

        <article className="summary-card panel">
          <h2>Trajectory explorer</h2>
          <div className="settings-actions">
            <select value={selectedPath} onChange={(e) => { setSelectedPath(e.target.value as 'probable' | 'best' | 'worst'); setSelectedPathIndex(0) }}><option value="probable">Самые вероятные</option><option value="best">Лучшие</option><option value="worst">Худшие</option></select>
            <select value={selectedPathIndex} onChange={(e) => setSelectedPathIndex(Number(e.target.value))}>{selectedCollection.map((_, idx) => <option value={idx} key={idx}>Путь {idx + 1}</option>)}</select>
          </div>
          <p>{selectedLine.map((point) => `Д${point.day}: I ${point.index.toFixed(1)} / P(c) ${(point.pCollapse * 100).toFixed(1)}%`).join(' · ')}</p>
        </article>
      </> : null}
    </section>
  )
}
