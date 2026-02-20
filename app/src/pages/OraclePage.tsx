import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { INDEX_METRIC_IDS, METRICS, type MetricId } from '../core/metrics'
import type { CheckinRecord } from '../core/models/checkin'
import {
  addQuest,
  addScenario,
  getActiveGoal,
  getLearnedMatrix,
  listCheckins,
  listScenarios,
  listStateSnapshots,
  loadInfluenceMatrix,
  seedTestData,
} from '../core/storage/repo'
import { explainDriverInsights } from '../core/engines/influence/influence'
import { consumeOracleScenarioDraft } from '../core/engines/influence/scenarioDraft'
import { resolveActiveMatrix } from '../core/engines/influence/weightsSource'
import type { InfluenceMatrix, MetricVector, OracleScenario, WeightsSource } from '../core/engines/influence/types'
import { computeIndexDay } from '../core/engines/analytics/compute'
import { formatDateTime, formatNumber } from '../ui/format'
import { computeCoreState } from '../core/engines/stateEngine'
import { assessCollapseRisk } from '../core/collapse/model'
import { regimeFromDay, getTransitionMatrix, predictNext, REGIMES } from '../core/regime/model'
import type { RegimeId } from '../core/models/regime'
import { buildPlaybook, propagateBySteps } from '../core/engines/influence/oracle'
import { SparkButton } from '../ui/SparkButton'
import { runForecastEngine, type ForecastRunConfig, type ForecastRunResult } from '../core/forecast'
import { FanChart } from '../ui/components/FanChart'
import { ForecastHonestyPanel } from '../ui/components/ForecastHonestyPanel'
import { getLatestForecastRun, saveForecastRun } from '../repo/forecastRepo'
import type { GoalRecord } from '../core/models/goal'
import { evaluateGoalScore } from '../core/engines/goal'
import { buildDailySeries, computeDebts, defaultTimeDebtRules } from '../core/engines/timeDebt'

const presets: { title: string; impulses: Partial<Record<MetricId, number>>; focus: MetricId[] }[] = [
  { title: 'Восстановление сна', impulses: { sleepHours: 1, stress: -1 }, focus: ['sleepHours', 'stress', 'energy'] },
  { title: 'Фокус без перегруза', impulses: { focus: 1, stress: -0.5 }, focus: ['focus', 'stress', 'productivity'] },
  { title: 'Социальная подпитка', impulses: { social: 1, mood: 1 }, focus: ['social', 'mood', 'stress'] },
  { title: 'Режим продуктивности', impulses: { productivity: 1, focus: 1, energy: 0.5 }, focus: ['productivity', 'focus', 'energy'] },
  { title: 'Антистресс минимум', impulses: { stress: -1, mood: 1, health: 1 }, focus: ['stress', 'mood', 'health'] },
]

function toVector(base?: CheckinRecord): MetricVector | undefined {
  if (!base) return undefined
  return METRICS.reduce((acc, metric) => {
    acc[metric.id] = base[metric.id]
    return acc
  }, {} as MetricVector)
}

const defaultConfig: ForecastRunConfig = {
  horizon: 7,
  simulations: 2000,
  backtestWindow: 30,
  seed: 42,
}

export function OraclePage({ latest, onQuestChange }: { latest?: CheckinRecord; onQuestChange: () => Promise<void> }) {
  const location = useLocation()
  const initialDraft = useMemo(() => (location.search.includes('prefill=1') ? consumeOracleScenarioDraft() : undefined), [location.search])
  const [impulses, setImpulses] = useState<Partial<Record<MetricId, number>>>(initialDraft?.impulses ?? {})
  const [focusMetrics, setFocusMetrics] = useState<MetricId[]>(initialDraft?.focusMetrics ?? ['energy', 'stress', 'sleepHours'])
  const [manualMatrix, setManualMatrix] = useState<InfluenceMatrix | null>(null)
  const [learnedMatrix, setLearnedMatrix] = useState<InfluenceMatrix | null>(null)
  const [weightsSource, setWeightsSource] = useState<WeightsSource>(initialDraft?.weightsSource ?? 'manual')
  const [mix, setMix] = useState<number>(initialDraft?.mix ?? 0.5)
  const [saved, setSaved] = useState<OracleScenario[]>([])
  const [baselineTs, setBaselineTs] = useState<number | 'latest'>(initialDraft?.baselineTs ?? 'latest')
  const [checkins, setCheckins] = useState<CheckinRecord[]>([])
  const [planSummary, setPlanSummary] = useState<string>('')
  const [prefillSource] = useState<string>(initialDraft?.sourceLabelRu ?? '')
  const [config, setConfig] = useState<ForecastRunConfig>(defaultConfig)
  const [forecast, setForecast] = useState<ForecastRunResult | null>(null)
  const [isRecomputing, setIsRecomputing] = useState(false)
  const [activeGoal, setActiveGoal] = useState<GoalRecord | null>(null)
  const navigate = useNavigate()

  const refreshOracleData = async () => {
    const [loadedManualMatrix, loadedScenarios, loadedCheckins, loadedLearned, latestRun, loadedGoal] = await Promise.all([
      loadInfluenceMatrix(),
      listScenarios(),
      listCheckins(),
      getLearnedMatrix(),
      getLatestForecastRun(),
      getActiveGoal(),
    ])
    setManualMatrix(loadedManualMatrix)
    setSaved(loadedScenarios)
    setCheckins(loadedCheckins)
    setLearnedMatrix(loadedLearned?.weights ?? loadedManualMatrix)
    setActiveGoal(loadedGoal ?? null)

    if (latestRun) {
      setForecast({
        config: latestRun.config,
        generatedAt: latestRun.ts,
        trainedOnDays: latestRun.trainedOnDays,
        index: {
          key: 'index',
          dates: [],
          point: latestRun.index.point,
          p10: latestRun.index.p10,
          p50: latestRun.index.p50,
          p90: latestRun.index.p90,
          modelType: latestRun.modelType,
          residualStd: latestRun.residualStats.std,
          backtest: latestRun.backtest,
        },
      })
      setConfig(latestRun.config)
    }
  }

  useEffect(() => {
    let cancelled = false
    void Promise.all([loadInfluenceMatrix(), listScenarios(), listCheckins(), getLearnedMatrix(), getLatestForecastRun(), getActiveGoal()]).then(([loadedManualMatrix, loadedScenarios, loadedCheckins, loadedLearned, latestRun, loadedGoal]) => {
      if (cancelled) return
      setManualMatrix(loadedManualMatrix)
      setSaved(loadedScenarios)
      setCheckins(loadedCheckins)
      setLearnedMatrix(loadedLearned?.weights ?? loadedManualMatrix)
      setActiveGoal(loadedGoal ?? null)
    setActiveGoal(loadedGoal ?? null)
      if (latestRun) {
        setConfig(latestRun.config)
        setForecast({
          config: latestRun.config,
          generatedAt: latestRun.ts,
          trainedOnDays: latestRun.trainedOnDays,
          index: {
            key: 'index',
            dates: [],
            point: latestRun.index.point,
            p10: latestRun.index.p10,
            p50: latestRun.index.p50,
            p90: latestRun.index.p90,
            modelType: latestRun.modelType,
            residualStd: latestRun.residualStats.std,
            backtest: latestRun.backtest,
          },
        })
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  const recomputeForecast = async () => {
    setIsRecomputing(true)
    const [snapshots, allCheckins] = await Promise.all([listStateSnapshots(400), listCheckins()])
    const result = runForecastEngine([...snapshots].reverse(), [...allCheckins].reverse(), config)
    setForecast(result)
    await saveForecastRun({
      ts: baseline.ts + 1,
      config,
      trainedOnDays: result.trainedOnDays,
      horizons: Array.from({ length: config.horizon }, (_, idx) => idx + 1),
      modelType: result.index.modelType,
      residualStats: { std: result.index.residualStd, sample: result.index.backtest.rows.length },
      backtest: result.index.backtest,
      index: {
        point: result.index.point,
        p10: result.index.p10,
        p50: result.index.p50,
        p90: result.index.p90,
      },
    })
    setIsRecomputing(false)
  }

  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const baseline = useMemo(() => {
    if (baselineTs === 'latest') return checkins[0] ?? latest
    return checkins.find((item) => item.ts === baselineTs) ?? checkins[0] ?? latest
  }, [baselineTs, checkins, latest])

  const baseVector = useMemo(() => toVector(baseline), [baseline])
  const matrix = useMemo(() => {
    if (!manualMatrix || !learnedMatrix) return null
    return resolveActiveMatrix(weightsSource, manualMatrix, learnedMatrix, mix)
  }, [weightsSource, manualMatrix, learnedMatrix, mix])
  const propagation = useMemo(() => (baseVector && matrix ? propagateBySteps(baseVector, impulses, matrix, 3) : undefined), [baseVector, impulses, matrix])
  const result = propagation?.[2]

  if (!baseline || !baseVector || !matrix || !result) {
    return <section className="page panel"><h1>Оракул</h1><article className="empty-state panel"><h2>Нет базовой точки для сценариев</h2><p>Сначала нужно зафиксировать состояние, чтобы прогнозировать импульсы и последствия.</p><div className="settings-actions"><SparkButton type="button" onClick={() => navigate('/core')}>Сделать чек-ин</SparkButton><SparkButton type="button" onClick={async () => { await seedTestData(30, 42); await refreshOracleData() }}>Сгенерировать тестовые данные (30 дней)</SparkButton><SparkButton type="button" onClick={() => navigate('/history')}>Выбрать базу из истории</SparkButton></div></article></section>
  }

  const baseIndex = computeIndexDay(baseline)
  const resultRecord = { ...baseline, ...result }
  const scenarioIndex = computeIndexDay(resultRecord)
  const indexDelta = scenarioIndex - baseIndex
  const drivers = explainDriverInsights(result, baseVector, matrix, 5)
  const playbook = buildPlaybook(baseVector, result, matrix)

  const baseState = computeCoreState([baseline], [], baseline.ts)
  const scenarioState = computeCoreState([resultRecord], [], baseline.ts)
  const baseCollapse = assessCollapseRisk(baseState, baseline)
  const scenarioCollapse = assessCollapseRisk(scenarioState, resultRecord)
  const collapseDelta = scenarioCollapse.pCollapse - baseCollapse.pCollapse
  const baseDebts = computeDebts(buildDailySeries(checkins), [], defaultTimeDebtRules)
  const scenarioDebts = computeDebts(buildDailySeries([{ ...resultRecord, ts: baseline.ts + 1 }, ...checkins]), [], defaultTimeDebtRules)
  const debtDelta = (scenarioDebts.sleepDebt + scenarioDebts.recoveryDebt + scenarioDebts.focusDebt + (scenarioDebts.socialDebt ?? 0)) - (baseDebts.sleepDebt + baseDebts.recoveryDebt + baseDebts.focusDebt + (baseDebts.socialDebt ?? 0))
  const goalEffect = activeGoal ? (() => {
    const baseScore = evaluateGoalScore(activeGoal, {
      index: baseIndex,
      pCollapse: baseCollapse.pCollapse,
      entropy: baseState.entropy,
      drift: baseState.drift,
      stats: baseState.stats,
      metrics: baseVector,
      forecast: forecast ? { p10: forecast.index.p10.at(-1), p50: forecast.index.p50.at(-1), p90: forecast.index.p90.at(-1) } : undefined,
    })
    const scenarioScore = evaluateGoalScore(activeGoal, {
      index: scenarioIndex,
      pCollapse: scenarioCollapse.pCollapse,
      entropy: scenarioState.entropy,
      drift: scenarioState.drift,
      stats: scenarioState.stats,
      metrics: result,
      forecast: forecast ? { p10: forecast.index.p10.at(-1), p50: forecast.index.p50.at(-1), p90: forecast.index.p90.at(-1) } : undefined,
    })
    return { delta: scenarioScore.goalScore - baseScore.goalScore, rationale: scenarioScore.explainTop3[0]?.textRu ?? 'Оценка выполнена по активной цели.' }
  })() : null
  const baselineRegime = regimeFromDay({ dayIndex: baseIndex * 10, volatility: baseState.volatility * 50, stress: baseline.stress, sleepHours: baseline.sleepHours, energy: baseline.energy, mood: baseline.mood })
  const scenarioRegime = regimeFromDay({ dayIndex: scenarioIndex * 10, volatility: scenarioState.volatility * 50, stress: resultRecord.stress, sleepHours: resultRecord.sleepHours, energy: resultRecord.energy, mood: resultRecord.mood, prevDayIndex: baseIndex * 10 })
  const matrixRegime = getTransitionMatrix([baselineRegime, scenarioRegime])
  const baseNext = predictNext(baselineRegime as RegimeId, matrixRegime, 1)
  const scenarioNext = predictNext(scenarioRegime as RegimeId, matrixRegime, 1)
  const bestSirenLever = drivers[0]

  const chartLabels = Array.from({ length: config.horizon }, (_, idx) => `+${idx + 1}д`)

  return <section className="page panel">
    <h1>Оракул</h1>
    <p>Сначала задайте сценарий, потом смотрите последствия.</p>
    {prefillSource ? <p className="chip">{prefillSource}</p> : null}

    <div className="settings-actions">
      <button
        type="button"
        onClick={() => {
          window.localStorage.setItem('gamno.blackSwanPrefill', JSON.stringify({ baseTs: baselineTs, weightsSource, mix, horizon: 7, sims: 2000 }))
          navigate('/black-swans')
        }}
      >
        Проверить на хвостовой риск
      </button>
      <button
        type="button"
        onClick={() => {
          window.localStorage.setItem('gamno.multiverseDraft', JSON.stringify({ baselineTs, impulses, focusMetrics, sourceLabelRu: 'Черновик из Оракула', weightsSource, mix }))
          navigate('/multiverse')
        }}
      >
        Открыть в Мультивселенной
      </button>
    </div>
    <div className="filters graph-filters"><span>Источник весов:</span>
      <button type="button" className={weightsSource === 'manual' ? 'filter-button filter-button--active' : 'filter-button'} onClick={() => setWeightsSource('manual')}>Manual</button>
      <button type="button" className={weightsSource === 'learned' ? 'filter-button filter-button--active' : 'filter-button'} onClick={() => setWeightsSource('learned')}>Learned</button>
      <button type="button" className={weightsSource === 'mixed' ? 'filter-button filter-button--active' : 'filter-button'} onClick={() => setWeightsSource('mixed')}>Mixed</button>
      {weightsSource === 'mixed' && <label>Mix {mix.toFixed(2)}<input type="range" min={0} max={1} step={0.05} value={mix} onChange={(e) => setMix(Number(e.target.value))} /></label>}
    </div>
    <div className="preset-row">{presets.map((preset) => <button key={preset.title} type="button" onClick={() => { setImpulses(preset.impulses); setFocusMetrics(preset.focus) }}>{preset.title}</button>)}</div>

    <div className="oracle-grid"><article className="summary-card panel"><h2>Базовая точка</h2><label>Чек-ин
      <select value={baselineTs} onChange={(e) => setBaselineTs(e.target.value === 'latest' ? 'latest' : Number(e.target.value))}><option value="latest">Последний</option>{checkins.map((row) => <option key={row.ts} value={row.ts}>{formatDateTime(row.ts)}</option>)}</select>
    </label><p>Индекс базы: <strong>{formatNumber(baseIndex)}</strong></p></article>

    <article className="summary-card panel"><h2>Конструктор сценария</h2><p>Выберите 3-5 метрик.</p><div className="metric-tags">{INDEX_METRIC_IDS.map((id) => {
      const m = METRICS.find((item) => item.id === id)!
      const active = focusMetrics.includes(id)
      return <button key={id} type="button" className={active ? 'filter-button filter-button--active' : 'filter-button'} onClick={() => setFocusMetrics((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= 5 ? prev : [...prev, id])}>{m.labelRu}</button>
    })}</div><div className="metric-cards">{focusMetrics.map((id) => {
      const m = METRICS.find((item) => item.id === id)!
      return <label key={id}>{m.labelRu} Δ<input type="number" value={impulses[id] ?? 0} onChange={(e) => setImpulses((p) => ({ ...p, [id]: Number(e.target.value) }))} /></label>
    })}</div></article>

    <article className="summary-card panel"><h2>Результат</h2><p>Новый индекс: <strong>{formatNumber(scenarioIndex)}</strong></p><p>Δ индекса: <strong>{indexDelta > 0 ? '+' : ''}{formatNumber(indexDelta)}</strong></p><p>P(collapse): <strong>{(scenarioCollapse.pCollapse * 100).toFixed(1)}%</strong> ({collapseDelta > 0 ? '+' : ''}{(collapseDelta * 100).toFixed(1)} п.п.)</p><p>Сдвиг режима next1: {REGIMES.map((regime) => `${regime.labelRu} ${((scenarioNext[regime.id].probability - baseNext[regime.id].probability) * 100).toFixed(1)}%`).join(' · ')}</p><p>Лучший рычаг для снижения Сирены: <strong>{bestSirenLever ? `${METRICS.find((m) => m.id === bestSirenLever.from)?.labelRu ?? bestSirenLever.from} → ${METRICS.find((m) => m.id === bestSirenLever.to)?.labelRu ?? bestSirenLever.to}` : 'нет'}</strong></p><ol>{propagation.map((vector, idx) => <li key={idx}>Шаг {idx + 1}: {METRICS.map((m) => `${m.labelRu} ${formatNumber(vector[m.id])}`).join(' | ')}</li>)}</ol>
      <p>Эффект на долг: <strong>{debtDelta >= 0 ? '+' : ''}{debtDelta.toFixed(2)}</strong></p>
      {goalEffect ? <p>Эффект на цель: <strong>{goalEffect.delta >= 0 ? '+' : ''}{goalEffect.delta.toFixed(1)}</strong>. {goalEffect.rationale}</p> : null}
      <button type="button" onClick={async () => {
        const strongest = drivers[0]
        if (!strongest) return
        const questTitle = `План на 3 дня: усилить ${METRICS.find((m) => m.id === strongest.from)?.labelRu ?? strongest.from}`
        await addQuest({ createdAt: Date.now(), title: questTitle, metricTarget: strongest.from, delta: 1, horizonDays: 3, status: 'active', predictedIndexLift: Math.max(0.3, indexDelta), goalId: activeGoal?.id })
        setPlanSummary(`План под цель принят: ${questTitle}. Источник весов: ${weightsSource}.`) ; await onQuestChange()
      }}>Принять план под цель</button>{planSummary ? <p className="chip">{planSummary}</p> : null}</article></div>

    <div className="oracle-grid"><article className="summary-card panel"><h2>Почему так</h2><ul>{drivers.map((driver) => <li key={`${driver.from}-${driver.to}`}>{driver.text} ({formatNumber(driver.strength)})</li>)}</ul></article><article className="summary-card panel"><h2>Плейбук</h2><ol>{playbook.map((item) => <li key={item}>{item}</li>)}</ol></article></div>

    <SparkButton type="button" onClick={async () => {
      const nameRu = window.prompt('Название сценария')
      if (!nameRu) return
      const scenario: OracleScenario = { ts: baseline.ts + 1, nameRu, baseTs: baseline.ts, impulses, result, index: scenarioIndex, weightsSource, mix }
      await addScenario(scenario)
      setSaved(await listScenarios())
    }}>Сохранить сценарий</SparkButton>

    <h2>Прогноз</h2>
    <article className="summary-card panel">
      <div className="forecast-controls">
        <label>Горизонт
          <select value={config.horizon} onChange={(e) => setConfig((prev) => ({ ...prev, horizon: Number(e.target.value) as 3 | 7 | 14 }))}>
            <option value={3}>3</option><option value={7}>7</option><option value={14}>14</option>
          </select>
        </label>
        <label>Симуляции
          <select value={config.simulations} onChange={(e) => setConfig((prev) => ({ ...prev, simulations: Number(e.target.value) as 500 | 2000 | 5000 }))}>
            <option value={500}>500</option><option value={2000}>2000</option><option value={5000}>5000</option>
          </select>
        </label>
        <label>Окно проверки
          <select value={config.backtestWindow} onChange={(e) => setConfig((prev) => ({ ...prev, backtestWindow: e.target.value === 'all' ? 'all' : Number(e.target.value) as 30 | 60 }))}>
            <option value={30}>30</option><option value={60}>60</option><option value="all">All</option>
          </select>
        </label>
        <label>Seed
          <input type="number" value={config.seed} onChange={(e) => setConfig((prev) => ({ ...prev, seed: Number(e.target.value) || 0 }))} />
        </label>
        <SparkButton type="button" onClick={recomputeForecast}>{isRecomputing ? 'Считаем...' : 'Пересчитать прогноз'}</SparkButton>
      </div>
      {forecast ? (
        <>
          <p>Модель: <strong>{forecast.index.modelType === 'ses' ? 'SES' : 'Holt'}</strong>. Обучено на <strong>{forecast.trainedOnDays}</strong> днях.</p>
          <FanChart labels={chartLabels} p10={forecast.index.p10} p50={forecast.index.p50} p90={forecast.index.p90} />
        </>
      ) : <p>Запустите расчёт, чтобы увидеть вероятностный прогноз.</p>}
    </article>

    {forecast ? <ForecastHonestyPanel backtest={forecast.index.backtest} /> : null}

    <h2>Сохраненные сценарии</h2>
    <ul>{saved.map((row) => <li key={`${row.ts}-${row.nameRu}`}>{row.nameRu}: {formatNumber(row.index)} · {row.weightsSource} · mix {row.mix.toFixed(2)}</li>)}</ul>
  </section>
}
