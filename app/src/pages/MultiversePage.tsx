import { useEffect, useMemo, useRef, useState } from 'react'
import { METRICS, type MetricId } from '../core/metrics'
import type { CheckinRecord } from '../core/models/checkin'
import type { OracleScenarioDraft, WeightsSource } from '../core/engines/influence/types'
import type { ActionLever, MultiverseConfig, MultiverseRunResult, PlannedImpulse } from '../core/engines/multiverse/types'
import { computeIndexDay, computeIndexSeries, computeVolatility } from '../core/engines/analytics/compute'
import { getTransitionMatrix, buildRegimeSeriesFromCheckins } from '../core/regime/model'
import { assessCollapseRisk } from '../core/collapse/model'
import { resolveActiveMatrix } from '../core/engines/influence/weightsSource'
import { formatDateTime } from '../ui/format'
import { addQuest, getActiveGoal, getLearnedMatrix, listCheckins, loadInfluenceMatrix, seedTestData } from '../core/storage/repo'
import { getLatestForecastRun } from '../repo/forecastRepo'
import { saveRun, getSettings, saveSettings } from '../repo/multiverseRepo'
import { cancelMultiverseWorker, createMultiverseWorker, runMultiverseInWorker } from '../core/workers/multiverseClient'

function consumeDraft(): OracleScenarioDraft | null {
  const key = 'gamno.multiverseDraft'
  const raw = window.localStorage.getItem(key) ?? window.localStorage.getItem('gamno.oracleDraft')
  if (!raw) return null
  window.localStorage.removeItem(key)
  window.localStorage.removeItem('gamno.oracleDraft')
  try { return JSON.parse(raw) as OracleScenarioDraft } catch { return null }
}

export function MultiversePage() {
  const [checkins, setCheckins] = useState<CheckinRecord[]>([])
  const [selectedBase, setSelectedBase] = useState<'latest' | number>('latest')
  const [source, setSource] = useState<WeightsSource>('mixed')
  const [mix, setMix] = useState(0.5)
  const [horizonDays, setHorizonDays] = useState<7 | 14 | 30>(14)
  const [runs, setRuns] = useState<1000 | 5000 | 10000 | 25000>(10000)
  const [seed, setSeed] = useState(42)
  const [noiseEnabled, setNoiseEnabled] = useState(true)
  const [shockMode, setShockMode] = useState<'off' | 'normal' | 'blackSwan'>('normal')
  const [manualMetric, setManualMetric] = useState<MetricId>('sleepHours')
  const [manualDelta, setManualDelta] = useState(0.3)
  const [result, setResult] = useState<MultiverseRunResult | null>(null)
  const [beforeAction, setBeforeAction] = useState<MultiverseRunResult | null>(null)
  const [selectedBranch, setSelectedBranch] = useState<'gold' | 'grey' | 'abyss'>('gold')
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const workerRef = useRef<Worker | null>(null)

  const loadRuntime = async (sourceMode: WeightsSource, mixValue: number) => {
    const [manualMatrix, learned, forecastRun, activeGoal] = await Promise.all([loadInfluenceMatrix(), getLearnedMatrix(), getLatestForecastRun(), getActiveGoal()])
    const effectiveSource: WeightsSource = sourceMode === 'learned' && !learned ? 'manual' : sourceMode
    const matrix = resolveActiveMatrix(effectiveSource, manualMatrix, learned?.weights ?? manualMatrix, mixValue)
    const residualStd = forecastRun?.residualStats.std ?? 0.8
    const residuals = Array.from({ length: 81 }, (_, index) => Number((((index - 40) / 10) * residualStd).toFixed(4)))
    return {
      matrix,
      stability: learned?.stability,
      weightsSource: effectiveSource,
      residuals,
      audit: { forecastModelType: forecastRun?.modelType, lags: learned?.meta.lags, trainedOnDays: learned?.meta.trainedOnDays },
      goalWeights: activeGoal?.weights,
      activeGoal,
    }
  }

  useEffect(() => {
    let cancelled = false
    void Promise.all([listCheckins(), getSettings()]).then(([rows, settings]) => {
      if (cancelled) return
      setCheckins(rows)
      if (settings?.value) {
        setHorizonDays(settings.value.horizonDays)
        setRuns(settings.value.sims)
        setSeed(settings.value.seed)
        setSource(settings.value.weightsSource)
        setMix(settings.value.mix)
        setShockMode(settings.value.useShockProfile ? 'normal' : 'off')
      }
      const draft = consumeDraft()
      if (draft?.baselineTs) setSelectedBase(draft.baselineTs)
      if (draft?.impulses) {
        const [firstMetric, firstDelta] = Object.entries(draft.impulses)[0] ?? []
        if (firstMetric) setManualMetric(firstMetric as MetricId)
        if (typeof firstDelta === 'number') setManualDelta(firstDelta)
      }
    })
    return () => { cancelled = true; workerRef.current?.terminate() }
  }, [])

  const baseline = useMemo(() => selectedBase === 'latest' ? checkins[0] : checkins.find((item) => item.ts === selectedBase) ?? checkins[0], [checkins, selectedBase])

  async function run(planImpulses?: PlannedImpulse[]) {
    if (!baseline) return
    const env = await loadRuntime(source, mix)
    const dayIndexes = computeIndexSeries(checkins)
    const volatility = computeVolatility(checkins, 'energy', 14) * 50
    const regimeSeries = buildRegimeSeriesFromCheckins([...checkins].reverse(), dayIndexes, volatility)
    const transitionMatrix = getTransitionMatrix(regimeSeries)
    const baseIndex = computeIndexDay(baseline)
    const baseCollapse = assessCollapseRisk({ ts: baseline.ts, index: baseIndex, risk: Math.max(0, 10 - baseIndex), volatility, xp: 0, level: 0, entropy: 0, drift: 0, stats: { strength: baseline.health * 10, intelligence: baseline.focus * 10, wisdom: baseline.mood * 10, dexterity: baseline.energy * 10 } }, baseline)

    const config: MultiverseConfig = {
      horizonDays,
      runs,
      seed,
      indexFloor: 40,
      collapseConstraintPct: 20,
      shockMode,
      baseVector: baseline,
      baseIndex,
      basePCollapse: baseCollapse.pCollapse,
      baseRegime: regimeSeries.at(-1) ?? 0,
      matrix: env.matrix,
      learnedStability: env.stability,
      weightsSource: env.weightsSource,
      mix,
      forecastResiduals: env.residuals,
      transitionMatrix,
      toggles: { forecastNoise: noiseEnabled, weightsNoise: true, stochasticRegime: true },
      plan: { nameRu: 'Ручной рычаг', impulses: planImpulses ?? [{ day: 0, metricId: manualMetric, delta: manualDelta }] },
      activeGoalWeights: env.goalWeights,
      audit: env.audit,
    }

    setRunning(true)
    setProgress({ done: 0, total: runs })
    setError(null)
    workerRef.current?.terminate()
    workerRef.current = createMultiverseWorker((message) => {
      if (message.type === 'progress') setProgress({ done: message.done, total: message.total })
      if (message.type === 'error') { setError(message.message); setRunning(false) }
      if (message.type === 'done') { setResult(message.result); setRunning(false) }
      if (message.type === 'cancelled') setRunning(false)
    })
    runMultiverseInWorker(workerRef.current, config)
    await saveSettings({ horizonDays, sims: runs, seed, weightsSource: source, mix, useShockProfile: shockMode !== 'off' })
  }

  async function applyLever(lever: ActionLever) {
    if (!result) return
    setBeforeAction(result)
    await run([{ day: 0, metricId: lever.metricId, delta: lever.delta }])
  }

  async function acceptMission() {
    const activeGoal = await getActiveGoal()
    const branch = result?.branches.find((item) => item.id === selectedBranch)
    await addQuest({
      createdAt: Date.now(),
      title: `План из ветки: ${branch?.nameRu ?? 'Мультивселенная'}`,
      metricTarget: manualMetric,
      delta: manualDelta,
      horizonDays: 3,
      status: 'active',
      predictedIndexLift: (branch?.expectedIndex.at(-1) ?? 0) - (baseline ? computeIndexDay(baseline) : 0),
      goalId: activeGoal?.id,
    })
    window.alert('Ветка принята как план на 3 дня.')
  }

  const deltaAfter = useMemo(() => {
    if (!beforeAction || !result) return null
    return (result.quantiles.index.p50.at(-1) ?? 0) - (beforeAction.quantiles.index.p50.at(-1) ?? 0)
  }, [beforeAction, result])

  return (
    <section className="page">
      <h1>Мультивселенная</h1>
      <p>Навигация по веткам будущего: рост, инерция и риск.</p>

      <div className="multiverse-grid">
        <article className="summary-card panel">
          <h2>Базовая точка</h2>
          <label>Источник базы
            <select value={selectedBase} onChange={(event) => setSelectedBase(event.target.value === 'latest' ? 'latest' : Number(event.target.value))}>
              <option value="latest">Последний чек-ин</option>
              {checkins.map((row) => <option key={row.ts} value={row.ts}>{formatDateTime(row.ts)}</option>)}
            </select>
          </label>
          <div className="settings-actions">
            <button type="button" onClick={async () => { await seedTestData(30, 42); setCheckins(await listCheckins()) }}>Посеять 30 дней</button>
            <button type="button" onClick={() => { const raw = window.prompt('Вставьте JSON чек-ина') ?? ''; try { const parsed = JSON.parse(raw) as CheckinRecord; setCheckins((prev) => [parsed, ...prev]) } catch { setError('Ошибка импорта чек-ина') } }}>Импорт базы</button>
          </div>
        </article>

        <article className="summary-card panel">
          <h2>Контур расчёта</h2>
          <label>Горизонт<select value={horizonDays} onChange={(e) => setHorizonDays(Number(e.target.value) as 7 | 14 | 30)}><option value={7}>7 дней</option><option value={14}>14 дней</option><option value={30}>30 дней</option></select></label>
          <label>Симуляции<select value={runs} onChange={(e) => setRuns(Number(e.target.value) as 1000 | 5000 | 10000 | 25000)}><option value={1000}>1k</option><option value={5000}>5k</option><option value={10000}>10k</option><option value={25000}>25k</option></select></label>
          <label>Seed<input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value) || 0)} /></label>
          <label>Источник весов<select value={source} onChange={(e) => setSource(e.target.value as WeightsSource)}><option value="manual">Ручной</option><option value="learned">Обученный</option><option value="mixed">Смешанный</option></select></label>
          {source === 'mixed' ? <label>Mix {mix.toFixed(2)}<input type="range" min={0} max={1} step={0.05} value={mix} onChange={(e) => setMix(Number(e.target.value))} /></label> : null}
          <label><input type="checkbox" checked={noiseEnabled} onChange={(e) => setNoiseEnabled(e.target.checked)} /> Шум прогноза</label>
          <label>Профиль шоков<select value={shockMode} onChange={(e) => setShockMode(e.target.value as 'off' | 'normal' | 'blackSwan')}><option value="off">Выключен</option><option value="normal">Нормальный</option><option value="blackSwan">Редкие тяжёлые</option></select></label>
          <label>Ручной рычаг<div className="settings-actions"><select value={manualMetric} onChange={(e) => setManualMetric(e.target.value as MetricId)}>{METRICS.map((m) => <option key={m.id} value={m.id}>{m.labelRu}</option>)}</select><input type="number" step="0.1" value={manualDelta} onChange={(e) => setManualDelta(Number(e.target.value) || 0)} /></div></label>
          <div className="settings-actions">
            <button type="button" onClick={() => run()} disabled={running || !baseline}>Рассчитать ветки</button>
            <button type="button" onClick={() => { if (workerRef.current) cancelMultiverseWorker(workerRef.current); workerRef.current?.terminate(); setRunning(false) }} disabled={!running}>Отмена</button>
          </div>
          {progress ? <progress max={progress.total} value={progress.done} /> : null}
          {error ? <p>{error}</p> : null}
        </article>
      </div>

      {result ? <>
        <h2>Колода веток</h2>
        <div className="multiverse-grid">
          {result.branches.map((branch) => (
            <article key={branch.id} className="summary-card panel">
              <h3>{branch.nameRu}</h3>
              <p>Вероятность: <strong>{(branch.probability * 100).toFixed(1)}%</strong></p>
              <p>Индекс (конец): <strong>{branch.expectedIndex.at(-1)?.toFixed(2)}</strong></p>
              <p>P(collapse): <strong>{((branch.expectedPCollapse.at(-1) ?? 0) * 100).toFixed(1)}%</strong></p>
              <p>GoalScore: <strong>{branch.goalScoreEnd.toFixed(1)}</strong> ({branch.goalScoreDelta >= 0 ? '+' : ''}{branch.goalScoreDelta.toFixed(2)})</p>
              <p>Хвост: <strong>{branch.tailRiskChip}</strong></p>
              <p>Debt pressure: <strong>{(branch.expectedPCollapse.at(-1) ?? 0) > (result.quantiles.pCollapse.p50.at(-1) ?? 0) ? 'растёт' : 'снижается'}</strong></p>
              <ul>{branch.topDrivers.map((driver) => <li key={driver}>{driver}</li>)}</ul>
              <button type="button" onClick={() => setSelectedBranch(branch.id)}>Выбрать ветку</button>
            </article>
          ))}
        </div>

        <article className="summary-card panel">
          <h2>Рычаги действий</h2>
          <ul>
            {result.actionLevers.slice(0, 3).map((lever) => (
              <li key={lever.metricId}>
                <strong>{lever.titleRu}</strong> ({lever.delta > 0 ? '+' : ''}{lever.delta.toFixed(1)}) — {lever.reasonRu}
                <button type="button" onClick={() => { void applyLever(lever) }}>Применить</button>
              </li>
            ))}
          </ul>
          {deltaAfter !== null ? <p>Δ p50 после применения рычага: <strong>{deltaAfter >= 0 ? '+' : ''}{deltaAfter.toFixed(2)}</strong></p> : null}
          <button type="button" onClick={acceptMission}>Принять ветку как план на 3 дня</button>
          <button type="button" onClick={async () => { if (!result) return; await saveRun({ ts: result.generatedAt, config: result.config, summary: result.tail, quantiles: result.quantiles, samplePaths: result.samplePaths, audit: result.audit, branches: result.branches }) }}>Сохранить прогон</button>
        </article>
      </> : null}

      <article className="summary-card panel">
        <h2>Ограничения и ответственность</h2>
        <p>Это вероятностная ассоциативная модель, а не доказательство причинности.</p>
        <p>Материал не является медицинской или финансовой рекомендацией.</p>
      </article>
    </section>
  )
}
