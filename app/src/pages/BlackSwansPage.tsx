import { useEffect, useMemo, useRef, useState } from 'react'
import type { CheckinRecord } from '../core/models/checkin'
import { getLearnedMatrix, listCheckins, loadInfluenceMatrix } from '../core/storage/repo'
import type { BlackSwanResult, BlackSwanScenarioSpec } from '../core/engines/blackSwan/types'
import { BLACK_SWAN_PRESETS } from '../core/engines/blackSwan/presets'
import { createBlackSwanWorker, runBlackSwanInWorker, cancelBlackSwanWorker } from '../core/workers/blackSwanClient'
import { FanChart } from '../ui/components/FanChart'
import { HistogramChart } from '../ui/components/HistogramChart'
import { createBlackSwanScenario, deleteBlackSwanScenario, getLastBlackSwanRun, listBlackSwanScenarios, saveBlackSwanRun, updateBlackSwanScenario } from '../repo/blackSwanRepo'
import type { WeightsSource } from '../core/engines/influence/types'

const defaultScenario: BlackSwanScenarioSpec = { nameRu: 'Пользовательский сценарий', shocks: [] }

function randomSeed(): number { return Math.floor(Math.random() * 1_000_000_000) }


function readPrefill(): { baseTs?: number | 'latest'; weightsSource?: WeightsSource; mix?: number; horizon?: 7 | 14 | 30; sims?: 500 | 2000 | 10000 } | null {
  const raw = window.localStorage.getItem('gamno.blackSwanPrefill')
  if (!raw) return null
  try { return JSON.parse(raw) as { baseTs?: number | 'latest'; weightsSource?: WeightsSource; mix?: number; horizon?: 7 | 14 | 30; sims?: 500 | 2000 | 10000 } } catch { return null }
}


export function BlackSwansPage() {
  const [checkins, setCheckins] = useState<CheckinRecord[]>([])
  const prefill = readPrefill()
  const [baseTs, setBaseTs] = useState<number | 'latest'>(prefill?.baseTs ?? 'latest')
  const [weightsSource, setWeightsSource] = useState<WeightsSource>(prefill?.weightsSource ?? 'mixed')
  const [mix] = useState(0.5)
  const [horizon, setHorizon] = useState<7 | 14 | 30>(prefill?.horizon ?? 14)
  const [sims, setSims] = useState<500 | 2000 | 10000>(prefill?.sims ?? 2000)
  const [seed, setSeed] = useState(42)
  const [noise, setNoise] = useState(1)
  const [threshold, setThreshold] = useState(0.35)
  const [scenario, setScenario] = useState<BlackSwanScenarioSpec>(defaultScenario)
  const [savedScenarios, setSavedScenarios] = useState<Array<{ id?: number; name: string; spec: BlackSwanScenarioSpec }>>([])
  const [result, setResult] = useState<BlackSwanResult | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [running, setRunning] = useState(false)
  const workerRef = useRef<Worker | null>(null)

  const base = useMemo(() => (baseTs === 'latest' ? checkins[0] : checkins.find((item) => item.ts === baseTs)), [baseTs, checkins])

  async function refresh() {
    const [rows, saved, lastRun] = await Promise.all([listCheckins(), listBlackSwanScenarios(), getLastBlackSwanRun()])
    setCheckins(rows)
    setSavedScenarios(saved.map((s) => ({ id: s.id, name: s.name, spec: s.spec })))
    if (lastRun) {
      setResult({ generatedAt: lastRun.ts, horizonDays: lastRun.horizon, simulations: lastRun.sims, seed: lastRun.seed, coreIndex: lastRun.payload.coreIndex, pCollapse: lastRun.payload.pCollapse, days: lastRun.payload.days, histogram: lastRun.payload.histogram, tail: lastRun.payload.tail, topDrivers: lastRun.payload.topDrivers, recommendations: lastRun.payload.recommendations, noteRu: lastRun.payload.noteRu, summary: lastRun.summary })
    }
  }

  useEffect(() => {
    window.localStorage.removeItem('gamno.blackSwanPrefill')
    const timer = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  const run = async () => {
    if (!base || running) return
    setRunning(true)
    setProgress({ done: 0, total: sims })
    const [manual, learned] = await Promise.all([loadInfluenceMatrix(), getLearnedMatrix()])
    const matrix = weightsSource === 'manual' ? manual : weightsSource === 'learned' ? (learned?.weights ?? manual) : Object.fromEntries(Object.entries(manual).map(([from, row]) => [from, Object.fromEntries(Object.keys(row ?? {}).map((to) => [to, Number((((row as Record<string, number>)[to] ?? 0) * 0.5 + ((learned?.weights as Record<string, Record<string, number>> | undefined)?.[from]?.[to] ?? 0) * 0.5).toFixed(4))]))])) as typeof manual

    const worker = createBlackSwanWorker((msg) => {
      if (msg.type === 'progress') setProgress({ done: msg.done, total: msg.total })
      if (msg.type === 'done') {
        setResult(msg.result)
        setRunning(false)
        setProgress(null)
        void saveBlackSwanRun({
          ts: msg.result.generatedAt,
          baseId: base.id,
          horizon,
          sims,
          seed,
          weightsSource,
          mix,
          scenarioInline: scenario,
          summary: { ...msg.result.summary, probEverRed: msg.result.tail.probEverRed, probThresholdEnd: msg.result.tail.probThresholdEnd, esCoreIndex: msg.result.tail.esCoreIndex },
          payload: { days: msg.result.days, coreIndex: msg.result.coreIndex, pCollapse: msg.result.pCollapse, histogram: msg.result.histogram, tail: msg.result.tail, topDrivers: msg.result.topDrivers, recommendations: msg.result.recommendations, noteRu: msg.result.noteRu },
        })
      }
      if (msg.type === 'cancelled' || msg.type === 'error') { setRunning(false); setProgress(null) }
    })
    workerRef.current = worker
    runBlackSwanInWorker(worker, { baseRecord: base, history: checkins, matrix, learnedLag: learned?.meta.lags, settings: { horizonDays: horizon, simulations: sims, noiseMultiplier: noise, thresholdCollapse: threshold, alpha: 0.1, weightsSource, mix, targetRedProb: 0.1 }, scenario, seed })
  }

  return <section className="page panel">
    <h1>Чёрные лебеди</h1>
    <p>Стресс-тест, хвостовые риски и запас прочности для режима.</p>
    <div className="oracle-grid">
      <article className="summary-card panel"><h2>Быстрый прогон</h2>
        <label>База<select value={baseTs} onChange={(e) => setBaseTs(e.target.value === 'latest' ? 'latest' : Number(e.target.value))}><option value="latest">Последний чек-ин</option>{checkins.map((c) => <option key={c.ts} value={c.ts}>{new Date(c.ts).toLocaleString('ru-RU')}</option>)}</select></label>
        <label>Источник весов<select value={weightsSource} onChange={(e) => setWeightsSource(e.target.value as WeightsSource)}><option value="manual">Manual</option><option value="learned">Learned</option><option value="mixed">Mixed</option></select></label>
        <label>Горизонт<select value={horizon} onChange={(e) => setHorizon(Number(e.target.value) as 7 | 14 | 30)}><option value={7}>7</option><option value={14}>14</option><option value={30}>30</option></select></label>
        <label>Симуляции<select value={sims} onChange={(e) => setSims(Number(e.target.value) as 500 | 2000 | 10000)}><option value={500}>500</option><option value={2000}>2000</option><option value={10000}>10000</option></select></label>
        <label>Seed<input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value) || 0)} /></label>
        <div className="settings-actions"><button type="button" onClick={() => setSeed(randomSeed())}>случайный</button></div>
        <label>Noise {noise.toFixed(2)}<input type="range" min={0.5} max={2} step={0.1} value={noise} onChange={(e) => setNoise(Number(e.target.value))} /></label>
        <label>Порог P(collapse)<input type="number" step={0.01} value={threshold} onChange={(e) => setThreshold(Number(e.target.value) || 0.35)} /></label>
        <div className="settings-actions"><button type="button" className="save-button" onClick={run} disabled={!base || running}>Запустить прогон</button><button type="button" disabled={!running} onClick={() => { if (workerRef.current) { cancelBlackSwanWorker(workerRef.current); workerRef.current.terminate() } }}>Отмена</button></div>
        {progress ? <p>Вычисление… {Math.round((progress.done / progress.total) * 100)}%</p> : null}
      </article>

      <article className="summary-card panel"><h2>Колода сценариев</h2>
        <div className="preset-row">{BLACK_SWAN_PRESETS.map((preset) => <button key={preset.nameRu} type="button" onClick={() => { setScenario(preset); setHorizon(preset.horizonDays ?? 14); setSims(preset.sims ?? 2000); setNoise(preset.noise ?? 1); void run() }}>{preset.nameRu}</button>)}</div>
        <label>Имя<input value={scenario.nameRu} onChange={(e) => setScenario((p) => ({ ...p, nameRu: e.target.value }))} /></label>
        <label>Шоки JSON<textarea value={JSON.stringify(scenario.shocks)} onChange={(e) => { try { setScenario((p) => ({ ...p, shocks: JSON.parse(e.target.value) as BlackSwanScenarioSpec['shocks'] })) } catch { /* noop */ } }} rows={4} /></label>
        <div className="settings-actions"><button type="button" onClick={async () => { const saved = await createBlackSwanScenario(scenario); setSavedScenarios((prev) => [{ id: saved.id, name: saved.name, spec: saved.spec }, ...prev]) }}>Сохранить</button></div>
        <ul>{savedScenarios.map((item) => <li key={item.id}><button type="button" onClick={() => setScenario(item.spec)}>{item.name}</button> <button type="button" onClick={async () => { if (!item.id) return; await updateBlackSwanScenario(item.id, scenario); await refresh() }}>Обновить</button> <button type="button" onClick={async () => { if (!item.id) return; await deleteBlackSwanScenario(item.id); await refresh() }}>Удалить</button></li>)}</ul>
      </article>
    </div>

    {result ? <>
      <article className="summary-card panel"><h2>Fan chart индекса (p10 / p50 / p90)</h2><FanChart labels={result.days.map((d) => `Д${d}`)} p10={result.coreIndex.p10} p50={result.coreIndex.p50} p90={result.coreIndex.p90} /></article>
      <article className="summary-card panel"><h2>Распределение P(collapse) в конце горизонта</h2><HistogramChart data={result.histogram} /></article>
      <div className="multiverse-grid">
        <article className="summary-card panel"><h2>Tail-risk</h2><p>Prob(Siren RED хотя бы раз): <strong>{(result.tail.probEverRed * 100).toFixed(1)}%</strong></p><p>Prob(P(collapse) ≥ {threshold.toFixed(2)}) конец: <strong>{(result.tail.probThresholdEnd * 100).toFixed(1)}%</strong></p><p>Prob(P(collapse) ≥ {threshold.toFixed(2)}) хотя бы раз: <strong>{(result.tail.probThresholdEver * 100).toFixed(1)}%</strong></p><p>CVaR Index α=0.10: <strong>{result.tail.esCoreIndex.toFixed(2)}</strong></p><p>CVaR P(collapse) α=0.10: <strong>{result.tail.esCollapse.toFixed(3)}</strong></p></article>
        <article className="summary-card panel"><h2>Margin of Safety</h2><p>Чтобы держать RED ≤ 10%, приоритетные рычаги:</p><ol>{result.recommendations.map((r) => <li key={r.metricId}><strong>{r.actionRu}</strong><br />Index Δ p10/p50/p90: {r.effectIndex.p10.toFixed(2)} / {r.effectIndex.p50.toFixed(2)} / {r.effectIndex.p90.toFixed(2)}<br />P(collapse) Δ p10/p50/p90: {r.effectCollapse.p10.toFixed(3)} / {r.effectCollapse.p50.toFixed(3)} / {r.effectCollapse.p90.toFixed(3)}</li>)}</ol><p>{result.noteRu}</p></article>
      </div>
    </> : null}
  </section>
}
