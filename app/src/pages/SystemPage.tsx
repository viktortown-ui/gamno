import { schemaVersion } from '../core/storage/db'
import { db } from '../core/storage/db'
import { getLastFrame } from '../repo/frameRepo'
import { getLatestForecastRun } from '../repo/forecastRepo'
import { getLastBlackSwanRun } from '../repo/blackSwanRepo'
import { getLastRun as getLastMultiverseRun } from '../repo/multiverseRepo'
import { useEffect, useState } from 'react'
import { evaluateModelHealth, type ModelHealthSnapshot } from '../core/engines/analytics/modelHealth'
import { createTailBacktestWorker, runTailBacktestInWorker, type TailBacktestWorkerMessage } from '../core/workers/tailBacktestClient'
import { CalibrationTrustCard } from '../ui/components/CalibrationTrust'

interface SystemStats {
  frameTs?: number
  forecastTs?: number
  blackSwanTs?: number
  multiverseTs?: number
  counts: Record<string, number>
  health: { learned: ModelHealthSnapshot; forecast: ModelHealthSnapshot; policy: ModelHealthSnapshot } | null
  safeModeTriggers: Array<{ ts: number; chosenActionId: string; gatesApplied: string[]; reasonsRu: string[]; fallbackPolicy?: string }>
  tailRiskPanel: Array<{ source: 'BlackSwans' | 'Multiverse' | 'Autopilot' | 'Tail-Backtest'; es: number; varValue: number; tailMass: number; failRate?: number; note?: string }>
}

function resolveTailBacktest(worker: Worker, payload: Parameters<typeof runTailBacktestInWorker>[1]): Promise<Extract<TailBacktestWorkerMessage, { type: 'done' }>['result']> {
  return new Promise((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<TailBacktestWorkerMessage>) => {
      if (event.data.type === 'done') resolve(event.data.result)
      else reject(new Error(event.data.message))
    }
    runTailBacktestInWorker(worker, payload)
  })
}

export function SystemPage() {
  const [stats, setStats] = useState<SystemStats>({ counts: {}, health: null, safeModeTriggers: [], tailRiskPanel: [] })

  useEffect(() => {
    const worker = createTailBacktestWorker(() => undefined)

    void Promise.all([
      getLastFrame(),
      getLatestForecastRun(),
      getLastBlackSwanRun(),
      getLastMultiverseRun(),
      db.checkins.count(),
      db.events.count(),
      db.frameSnapshots.count(),
      db.multiverseRuns.count(),
      db.learnedMatrices.toArray(),
      db.forecastRuns.orderBy('ts').reverse().limit(12).toArray(),
      db.actionAudits.orderBy('ts').reverse().limit(36).toArray(),
      db.frameSnapshots.orderBy('ts').toArray(),
    ]).then(async ([frame, forecast, blackSwan, multiverse, checkins, events, frames, runs, learnedMatrices, forecastRuns, audits, frameRows]) => {
      const learnedCalibrationRows = learnedMatrices
        .map((item) => ({ probability: Math.min(1, item.trainedOnDays / 100), outcome: (item.lags >= 2 ? 1 : 0) as 0 | 1 }))
      const learnedCalibration = learnedCalibrationRows.length
        ? learnedCalibrationRows
        : [{ probability: 0.5, outcome: 1 as 0 | 1 }]
      const learnedDrift = learnedMatrices.map((item) => item.trainedOnDays)

      const forecastCalibrationRows = forecastRuns
        .flatMap((run) => run.backtest.rows.map((row) => ({ probability: Math.max(0, Math.min(1, row.p90 - row.p10)), outcome: (row.insideBand ? 1 : 0) as 0 | 1 })))
      const forecastCalibration = forecastCalibrationRows.length
        ? forecastCalibrationRows
        : [{ probability: 0.5, outcome: 1 as 0 | 1 }]
      const forecastDrift = forecastRuns.map((run) => run.backtest.averageIntervalWidth)

      const policyHealth = audits[0]?.modelHealth
        ? evaluateModelHealth({ kind: 'policy', calibration: audits[0].modelHealth.calibration.bins.map((bin) => ({ probability: bin.meanProbability, outcome: (bin.observedRate >= 0.5 ? 1 : 0) as 0 | 1 })), driftSeries: [audits[0].modelHealth.drift.score], minSamples: audits[0].modelHealth.data.minSamples ?? 6 })
        : evaluateModelHealth({ kind: 'policy', calibration: [{ probability: 0.5, outcome: 1 as 0 | 1 }], driftSeries: [0], minSamples: 6 })

      const tailBacktest = await resolveTailBacktest(worker, {
        audits: audits.map((item) => ({ ts: item.ts, horizonSummary: item.horizonSummary })),
        frames: frameRows.map((item) => ({ ts: item.ts, payload: item.payload })),
        minSamples: 2,
      })
      const tailSignals = tailBacktest.aggregates
        .filter((item) => item.sampleCount >= 2)
        .sort((a, b) => (b.tailExceedRate - a.tailExceedRate) || (b.tailLossRatio - a.tailLossRatio) || (a.horizonDays - b.horizonDays) || a.policyMode.localeCompare(b.policyMode))

      const health = {
        learned: evaluateModelHealth({ kind: 'learned', calibration: learnedCalibration, driftSeries: learnedDrift, minSamples: 3 }),
        forecast: evaluateModelHealth({ kind: 'forecast', calibration: forecastCalibration, driftSeries: forecastDrift, minSamples: 8 }),
        policy: policyHealth,
      }

      const safeModeTriggers = audits
        .filter((audit) => audit.safeMode)
        .slice(0, 8)
        .map((audit) => ({
          ts: audit.ts,
          chosenActionId: audit.chosenActionId,
          gatesApplied: audit.gatesApplied ?? [],
          reasonsRu: audit.gateReasonsRu ?? [],
          fallbackPolicy: audit.fallbackPolicy,
        }))

      const autopilotTail = audits[0]?.horizonSummary?.slice().sort((a, b) => (a.horizonDays - b.horizonDays) || a.policyMode.localeCompare(b.policyMode) || a.actionId.localeCompare(b.actionId))[0]
      const topTailSignal = tailSignals[0]

      const tailRiskPanel: SystemStats['tailRiskPanel'] = [
        {
          source: 'BlackSwans',
          es: blackSwan?.payload.tail.collapseTail.es ?? 0,
          varValue: blackSwan?.payload.tail.collapseTail.var ?? 0,
          tailMass: blackSwan?.payload.tail.collapseTail.tailMass ?? 0,
        },
        {
          source: 'Multiverse',
          es: multiverse?.summary.collapseTail.es ?? 0,
          varValue: multiverse?.summary.collapseTail.var ?? 0,
          tailMass: multiverse?.summary.collapseTail.tailMass ?? 0,
        },
        {
          source: 'Autopilot',
          es: autopilotTail?.stats.es97_5 ?? 0,
          varValue: autopilotTail?.stats.var97_5 ?? 0,
          tailMass: autopilotTail?.stats.tailMass ?? 0,
          failRate: autopilotTail?.stats.failRate,
        },
        {
          source: 'Tail-Backtest',
          es: topTailSignal?.tailLossRatio ?? 0,
          varValue: topTailSignal?.tailExceedRate ?? 0,
          tailMass: Math.min(1, (topTailSignal?.sampleCount ?? 0) / 10),
          note: topTailSignal ? `${topTailSignal.policyMode}/H${topTailSignal.horizonDays}` : 'нет данных',
        },
      ]

      setStats({ frameTs: frame?.ts, forecastTs: forecast?.ts, blackSwanTs: blackSwan?.ts, multiverseTs: multiverse?.ts, counts: { checkins, events, frames, runs }, health, safeModeTriggers, tailRiskPanel })
    })

    return () => worker.terminate()
  }, [])

  return (
    <section className="page">
      <h1>Система</h1>
      <article className="panel">
        <p>schemaVersion: <strong className="mono">{schemaVersion}</strong></p>
        <p>Последний кадр: <strong className="mono">{stats.frameTs ?? '—'}</strong></p>
        <p>Последний прогноз: <strong className="mono">{stats.forecastTs ?? '—'}</strong></p>
        <p>Последний Чёрные лебеди: <strong className="mono">{stats.blackSwanTs ?? '—'}</strong></p>
        <p>Последний Мультивселенная: <strong className="mono">{stats.multiverseTs ?? '—'}</strong></p>
        <p>Счётчики: checkins={stats.counts.checkins ?? 0}, events={stats.counts.events ?? 0}, frames={stats.counts.frames ?? 0}, runs={stats.counts.runs ?? 0}</p>

        <section className="panel" aria-label="Карта мира ссылка">
          <h2>Карта мира</h2>
          <p>Полный cockpit теперь открыт на отдельной странице.</p>
          <a href="#/world">Открыть карту мира</a>
        </section>

        {stats.health ? (
          <section aria-label="Calibration & Trust" className="calibration-grid">
            <h2>Calibration &amp; Trust</h2>
            <CalibrationTrustCard title="Learned" health={stats.health.learned} />
            <CalibrationTrustCard title="Forecast" health={stats.health.forecast} />
            <CalibrationTrustCard title="Policy" health={stats.health.policy} />
          </section>
        ) : null}

        <section className="panel" aria-label="Tail-Risk unified panel">
          <h2>Tail-Risk unified</h2>
          <ul>
            {stats.tailRiskPanel.map((item) => (
              <li key={item.source}>
                <strong>{item.source}</strong>: ES {item.es.toFixed(4)} · VaR {item.varValue.toFixed(4)} · tailMass {(item.tailMass * 100).toFixed(1)}%
                {typeof item.failRate === 'number' ? ` · failRate ${(item.failRate * 100).toFixed(1)}%` : ''}
                {item.note ? ` · ${item.note}` : ''}
              </li>
            ))}
          </ul>
        </section>
      </article>
    </section>
  )
}
