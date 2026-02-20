import { useEffect, useMemo, useRef, useState } from 'react'
import { METRICS, type MetricId } from '../core/metrics'
import type { CheckinRecord } from '../core/models/checkin'
import type { OracleScenarioDraft } from '../core/engines/influence/types'
import type { MultiverseConfig, MultiverseRunResult, PlannedImpulse } from '../core/engines/multiverse/types'
import { computeIndexDay, computeIndexSeries, computeVolatility } from '../core/engines/analytics/compute'
import { getTransitionMatrix, buildRegimeSeriesFromCheckins } from '../core/regime/model'
import { assessCollapseRisk } from '../core/collapse/model'
import { computeTopLevers, defaultInfluenceMatrix } from '../core/engines/influence/influence'
import { resolveActiveMatrix } from '../core/engines/influence/weightsSource'
import { FanChart } from '../ui/components/FanChart'
import { formatDateTime } from '../ui/format'
import { getActiveGoal, getLearnedMatrix, listCheckins, listScenarios, loadInfluenceMatrix } from '../core/storage/repo'
import { getLatestForecastRun } from '../repo/forecastRepo'
import { getLastMultiverseRun, saveMultiverseRun } from '../repo/multiverseRepo'

function mapImpulses(impulses: Partial<Record<MetricId, number>>, day = 0): PlannedImpulse[] {
  return Object.entries(impulses).map(([metricId, delta]) => ({ day, metricId: metricId as MetricId, delta: Number(delta ?? 0) }))
}

function readDraft(): OracleScenarioDraft | null {
  const raw = window.localStorage.getItem('gamno.oracleDraft')
  if (!raw) return null
  try {
    return JSON.parse(raw) as OracleScenarioDraft
  } catch {
    return null
  }
}

function buildHistogram(values: number[], bins = 12): Array<{ from: number; to: number; count: number }> {
  if (!values.length) return []
  const min = Math.min(...values)
  const max = Math.max(...values)
  const width = Math.max((max - min) / bins, 0.0001)
  const bucket = Array.from({ length: bins }, (_, idx) => ({ from: min + idx * width, to: min + (idx + 1) * width, count: 0 }))
  for (const value of values) {
    const index = Math.min(bucket.length - 1, Math.floor((value - min) / width))
    bucket[index].count += 1
  }
  return bucket
}

export function MultiversePage() {
  const [checkins, setCheckins] = useState<CheckinRecord[]>([])
  const [scenarios, setScenarios] = useState<Array<{ ts: number; nameRu: string; impulses: Partial<Record<MetricId, number>> }>>([])
  const [selectedBase, setSelectedBase] = useState<'latest' | number>('latest')
  const [selectedPlan, setSelectedPlan] = useState<'draft' | 'top3' | number>('draft')
  const [horizonDays, setHorizonDays] = useState<7 | 14 | 30>(14)
  const [runs, setRuns] = useState<1000 | 5000 | 10000>(5000)
  const [seed, setSeed] = useState(42)
  const [indexFloor, setIndexFloor] = useState(40)
  const [forecastNoise, setForecastNoise] = useState(true)
  const [weightsNoise, setWeightsNoise] = useState(true)
  const [stochasticRegime, setStochasticRegime] = useState(true)
  const [result, setResult] = useState<MultiverseRunResult | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const workerRef = useRef<Worker | null>(null)

  async function loadRuntime() {
    const [manualMatrix, learned, forecastRun, activeGoal] = await Promise.all([
      loadInfluenceMatrix(),
      getLearnedMatrix(),
      getLatestForecastRun(),
      getActiveGoal(),
    ])

    const matrix = resolveActiveMatrix('mixed', manualMatrix, learned?.weights ?? manualMatrix, 0.5)
    const residualStd = forecastRun?.residualStats.std ?? 0.8
    const residuals = Array.from({ length: 41 }, (_, index) => Number(((index - 20) / 10 * residualStd).toFixed(4)))

    return {
      matrix,
      stability: learned?.stability,
      weightsSource: learned ? 'mixed' as const : 'manual' as const,
      mix: learned ? 0.5 : 0,
      residuals,
      audit: {
        forecastModelType: forecastRun?.modelType,
        lags: learned?.meta.lags,
        trainedOnDays: learned?.meta.trainedOnDays,
      },
      goalWeights: activeGoal?.weights,
    }
  }

  useEffect(() => {
    let cancelled = false
    void Promise.all([listCheckins(), listScenarios(), getLastMultiverseRun()]).then(([rows, scenariosRows, last]) => {
      if (cancelled) return
      setCheckins(rows)
      setScenarios(scenariosRows.map((row) => ({ ts: row.ts, nameRu: row.nameRu, impulses: row.impulses })))
      if (last) setResult({
        generatedAt: last.ts,
        config: last.config,
        quantiles: last.quantiles,
        tail: last.summary,
        samplePaths: last.samplePaths,
        representativeWorstPath: last.samplePaths.at(-1) ?? [],
        hedges: [],
        distributions: { horizonIndex: [] },
        audit: last.audit,
      } as MultiverseRunResult)
    })

    return () => { cancelled = true; workerRef.current?.terminate() }
  }, [])

  const baseline = useMemo(() => {
    if (!checkins.length) return undefined
    if (selectedBase === 'latest') return checkins[0]
    return checkins.find((item) => item.ts === selectedBase) ?? checkins[0]
  }, [checkins, selectedBase])

  const plan = useMemo(() => {
    const draft = readDraft()
    if (selectedPlan === 'draft' && draft?.impulses) {
      return { nameRu: draft.sourceLabelRu ?? 'Черновик Оракула', impulses: mapImpulses(draft.impulses, 0) }
    }
    if (selectedPlan === 'top3' && baseline) {
      const top = computeTopLevers(baseline, defaultInfluenceMatrix, 3)
      return { nameRu: 'Топ-3 рычагов', impulses: top.map((row) => ({ day: 0, metricId: row.from, delta: row.suggestedDelta })) }
    }
    const scenario = scenarios.find((item) => item.ts === selectedPlan)
    if (scenario) return { nameRu: scenario.nameRu, impulses: mapImpulses(scenario.impulses, 0) }
    return { nameRu: 'Базовый план', impulses: [] as PlannedImpulse[] }
  }, [selectedPlan, scenarios, baseline])

  async function run() {
    if (!baseline) return
    const env = await loadRuntime()
    const dayIndexes = computeIndexSeries(checkins)
    const volatility = computeVolatility(checkins, 'energy', 14) * 50
    const regimeSeries = buildRegimeSeriesFromCheckins([...checkins].reverse(), dayIndexes, volatility)
    const transitionMatrix = getTransitionMatrix(regimeSeries)
    const baseIndex = computeIndexDay(baseline)
    const baseCollapse = assessCollapseRisk({
      ts: baseline.ts,
      index: baseIndex,
      risk: Math.max(0, 10 - baseIndex),
      volatility,
      xp: 0,
      level: 0,
      entropy: 0,
      drift: 0,
      stats: { strength: baseline.health * 10, intelligence: baseline.focus * 10, wisdom: baseline.mood * 10, dexterity: baseline.energy * 10 },
    }, baseline)

    const config: MultiverseConfig = {
      horizonDays,
      runs,
      seed,
      indexFloor,
      baseVector: baseline,
      baseIndex,
      basePCollapse: baseCollapse.pCollapse,
      baseRegime: regimeSeries.at(-1) ?? 0,
      matrix: env.matrix,
      learnedStability: env.stability,
      weightsSource: env.weightsSource,
      mix: env.mix,
      forecastResiduals: env.residuals,
      transitionMatrix,
      toggles: { forecastNoise, weightsNoise, stochasticRegime },
      plan,
      activeGoalWeights: env.goalWeights,
      audit: env.audit,
    }

    setRunning(true)
    setProgress({ done: 0, total: runs })
    setError(null)

    const worker = new Worker(new URL('../workers/multiverse.worker.ts', import.meta.url), { type: 'module' })
    workerRef.current = worker
    worker.onmessage = async (event: MessageEvent<{ type: string; done?: number; total?: number; message?: string; result?: MultiverseRunResult }>) => {
      if (event.data.type === 'progress') {
        setProgress({ done: event.data.done ?? 0, total: event.data.total ?? runs })
      }
      if (event.data.type === 'error') {
        setError(event.data.message ?? 'Ошибка')
        setRunning(false)
      }
      if (event.data.type === 'done' && event.data.result) {
        setResult(event.data.result)
        setRunning(false)
      }
      if (event.data.type === 'cancelled') {
        setRunning(false)
      }
    }

    worker.postMessage({ type: 'run', config })
  }

  async function saveRun() {
    if (!result) return
    await saveMultiverseRun({
      ts: result.generatedAt,
      config: result.config,
      summary: result.tail,
      quantiles: result.quantiles,
      samplePaths: result.samplePaths,
      audit: result.audit,
    })
  }

  const indexHistogram = buildHistogram(result?.distributions.horizonIndex ?? [])
  const goalHistogram = buildHistogram(result?.distributions.horizonGoalScore ?? [])

  return (
    <section className="page">
      <h1>Мультивселенная</h1>
      <div className="multiverse-grid">
        <article className="summary-card panel">
          <h2>База</h2>
          <label>Базовый чек-ин
            <select value={selectedBase} onChange={(event) => setSelectedBase(event.target.value === 'latest' ? 'latest' : Number(event.target.value))}>
              <option value="latest">Последний</option>
              {checkins.map((row) => <option key={row.ts} value={row.ts}>{formatDateTime(row.ts)}</option>)}
            </select>
          </label>
        </article>

        <article className="summary-card panel">
          <h2>План</h2>
          <label>Сценарий
            <select value={selectedPlan} onChange={(event) => setSelectedPlan(event.target.value === 'draft' || event.target.value === 'top3' ? event.target.value : Number(event.target.value))}>
              <option value="draft">Черновик Оракула</option>
              <option value="top3">Топ-3 рычагов</option>
              {scenarios.map((row) => <option key={row.ts} value={row.ts}>{row.nameRu}</option>)}
            </select>
          </label>
          <p>{plan.nameRu}: {plan.impulses.map((item) => `${item.metricId} ${item.delta > 0 ? '+' : ''}${item.delta}`).join(', ') || 'без импульсов'}</p>
        </article>

        <article className="summary-card panel">
          <h2>Параметры симуляции</h2>
          <div className="settings-appearance">
            <label>Горизонт
              <select value={horizonDays} onChange={(event) => setHorizonDays(Number(event.target.value) as 7 | 14 | 30)}><option value={7}>7</option><option value={14}>14</option><option value={30}>30</option></select>
            </label>
            <label>Прогоны
              <select value={runs} onChange={(event) => setRuns(Number(event.target.value) as 1000 | 5000 | 10000)}><option value={1000}>1000</option><option value={5000}>5000</option><option value={10000}>10000</option></select>
            </label>
            <label>Seed
              <input type="number" value={seed} onChange={(event) => setSeed(Number(event.target.value) || 0)} />
            </label>
            <label>Порог индекса
              <input type="number" value={indexFloor} onChange={(event) => setIndexFloor(Number(event.target.value) || 40)} />
            </label>
          </div>
          <label><input type="checkbox" checked={forecastNoise} onChange={(event) => setForecastNoise(event.target.checked)} /> Шум прогноза</label>
          <label><input type="checkbox" checked={weightsNoise} onChange={(event) => setWeightsNoise(event.target.checked)} /> Шум весов</label>
          <label><input type="checkbox" checked={stochasticRegime} onChange={(event) => setStochasticRegime(event.target.checked)} /> Стохастические переходы режимов</label>
          <div className="settings-actions">
            <button type="button" onClick={run} disabled={running || !baseline}>Запустить симуляцию</button>
            <button type="button" onClick={() => { workerRef.current?.postMessage({ type: 'cancel' }); workerRef.current?.terminate(); setRunning(false) }} disabled={!running}>Остановить</button>
            <button type="button" onClick={saveRun} disabled={!result}>Сохранить прогон</button>
          </div>
          {progress ? <p>Прогресс: {progress.done}/{progress.total}</p> : null}
          {error ? <p>{error}</p> : null}
        </article>
      </div>

      {result ? (
        <>
          <article className="summary-card panel">
            <h2>Диапазон индекса p10/p50/p90</h2>
            <FanChart labels={result.quantiles.days.map((day) => `Д${day}`)} p10={result.quantiles.index.p10} p50={result.quantiles.index.p50} p90={result.quantiles.index.p90} />
          </article>

          <div className="multiverse-grid">
            <article className="summary-card panel">
              <h2>Распределение на горизонте</h2>
              <ul>
                {indexHistogram.map((bin) => <li key={`${bin.from}-${bin.to}`}>{bin.from.toFixed(1)}…{bin.to.toFixed(1)}: {bin.count}</li>)}
              </ul>
            </article>
            {result.distributions.horizonGoalScore ? (
              <article className="summary-card panel">
                <h2>GoalScore на горизонте</h2>
                <ul>
                  {goalHistogram.map((bin) => <li key={`${bin.from}-${bin.to}`}>{bin.from.toFixed(1)}…{bin.to.toFixed(1)}: {bin.count}</li>)}
                </ul>
              </article>
            ) : null}

            <article className="summary-card panel">
              <h2>Хвост-риск</h2>
              <p>Вероятность красной Сирены: <strong>{(result.tail.redSirenAny * 100).toFixed(1)}%</strong></p>
              <p>Вероятность провала порога индекса: <strong>{(result.tail.indexFloorBreachAny * 100).toFixed(1)}%</strong></p>
              <p>CVaR (5%): <strong>{result.tail.cvar5Index.toFixed(2)}</strong></p>
              <p>Худший 5% путь: {result.representativeWorstPath.map((point) => `Д${point.day}:${point.index.toFixed(1)}`).join(' · ')}</p>
            </article>

            <article className="summary-card panel">
              <h2>Рекомендации (страховки)</h2>
              <ol>
                {result.hedges.map((hedge) => <li key={hedge.metricId}>{METRICS.find((metric) => metric.id === hedge.metricId)?.labelRu}: +{hedge.delta} (эффект {hedge.tailRiskImprovement.toFixed(3)})</li>)}
              </ol>
            </article>

            <article className="summary-card panel">
              <h2>Аудит расчёта</h2>
              <p>Источник весов: {result.audit.weightsSource}, mix {result.audit.mix.toFixed(2)}</p>
              <p>Модель прогноза: {result.audit.forecastModelType ?? 'нет данных'}</p>
              <p>Лаги: {result.audit.lags ?? 'нет данных'}, обучено на: {result.audit.trainedOnDays ?? 'нет данных'} дней</p>
              <p>Вероятностная оценка. Не доказывает причинность.</p>
            </article>
          </div>
        </>
      ) : null}
    </section>
  )
}
