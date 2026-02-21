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
import { createWorldMapWorker, runWorldMapInWorker, type WorldMapWorkerMessage } from '../core/workers/worldMapClient'
import type { WorldMapSnapshot } from '../core/worldMap/types'
import { WorldMapView } from '../ui/components/WorldMapView'

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
  const [worldMapSnapshot, setWorldMapSnapshot] = useState<WorldMapSnapshot | null>(null)

  useEffect(() => {
    const worker = createTailBacktestWorker(() => undefined)
    const worldMapWorker = createWorldMapWorker((message: WorldMapWorkerMessage) => {
      if (message.type === 'done') {
        setWorldMapSnapshot(message.result)
      }
    })

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
    ]).then(async ([frame, forecast, blackSwan, multiverse, checkins, events, frames, runs, matrices, forecasts, audits, frameSeries]) => {
      const learnedCalibration = matrices.map((item) => {
        const trained = Math.min(1, item.trainedOnDays / 60)
        const lagPenalty = Math.min(0.3, Math.abs(item.lags - 2) * 0.08)
        return {
          probability: Number((Math.max(0, Math.min(1, trained - lagPenalty))).toFixed(4)),
          outcome: item.trainedOnDays >= 30 ? 1 as const : 0 as const,
        }
      })
      const learnedDrift = matrices.map((item, index) => {
        if (index === 0) return 0
        return Number(Math.abs(item.trainedOnDays - matrices[index - 1].trainedOnDays) / 60)
      })

      const forecastCalibration = forecasts.flatMap((run) => run.backtest.rows.map((row) => {
        const width = Math.max(0.0001, row.p90 - row.p10)
        const normalized = Math.max(0, Math.min(1, (row.actual - row.p10) / width))
        return {
          probability: Number(normalized.toFixed(4)),
          outcome: row.insideBand ? 1 as const : 0 as const,
        }
      }))
      const forecastDrift = forecasts.map((run) => Number(run.backtest.averageIntervalWidth.toFixed(4)))

      const policyHealthFromAudit = audits[0]?.modelHealth as ModelHealthSnapshot | undefined
      const policyCalibration = audits.map(() => {
        const grade = policyHealthFromAudit?.grade ?? 'red'
        const probability = grade === 'green' ? 0.85 : grade === 'yellow' ? 0.6 : 0.25
        return { probability, outcome: (grade === 'red' ? 0 : 1) as 0 | 1 }
      })
      const policyDrift = audits.map((audit) => Number((audit.horizonSummary?.[0]?.stats.failRate ?? 0).toFixed(4)))
      const basePolicyHealth = policyHealthFromAudit ?? evaluateModelHealth({ kind: 'policy', calibration: policyCalibration, driftSeries: policyDrift, minSamples: 6 })

      const tailBacktest = await resolveTailBacktest(worker, {
        audits: audits.map((audit) => ({ ts: audit.ts, horizonSummary: audit.horizonSummary })),
        frames: frameSeries.map((item) => ({ ts: item.ts, payload: item.payload })),
        minSamples: 5,
      }).catch(() => ({ points: [], aggregates: [], warnings: ['Tail backtest worker error.'] }))

      const tailSignals = tailBacktest.aggregates
        .slice()
        .sort((a, b) => (a.horizonDays - b.horizonDays) || a.policyMode.localeCompare(b.policyMode))
        .map((item) => ({
          horizonDays: item.horizonDays,
          policyMode: item.policyMode,
          tailExceedRate: item.tailExceedRate,
          tailLossRatio: item.tailLossRatio,
          sampleCount: item.sampleCount,
          warnings: item.warnings,
        }))

      const policyHealth: ModelHealthSnapshot = {
        ...basePolicyHealth,
        tailBacktest: {
          generatedAt: Date.now(),
          signals: tailSignals,
          warnings: tailBacktest.warnings,
        },
        reasonsRu: [
          ...basePolicyHealth.reasonsRu,
          tailSignals.length
            ? `Tail-Backtest: ${tailSignals[0].policyMode}/H${tailSignals[0].horizonDays} exceed ${(tailSignals[0].tailExceedRate * 100).toFixed(1)}%, ratio ${tailSignals[0].tailLossRatio.toFixed(2)}.`
            : 'Tail-Backtest: недостаточно данных.',
        ],
      }

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

      if (frame) {
        runWorldMapInWorker(worldMapWorker, {
          frame: frame.payload,
          seed: 12,
          viewport: { width: 1100, height: 540, padding: 24 },
        })
      }
      setStats({ frameTs: frame?.ts, forecastTs: forecast?.ts, blackSwanTs: blackSwan?.ts, multiverseTs: multiverse?.ts, counts: { checkins, events, frames, runs }, health, safeModeTriggers, tailRiskPanel })
    })

    return () => {
      worker.terminate()
      worldMapWorker.terminate()
    }
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

        <section className="panel" aria-label="Safe Mode triggers">
          <h2>Safe Mode triggers</h2>
          {stats.safeModeTriggers.length ? (
            <ul>
              {stats.safeModeTriggers.map((item) => (
                <li key={`${item.ts}-${item.chosenActionId}`}>
                  {new Date(item.ts).toLocaleString('ru-RU')} · action {item.chosenActionId}
                  {item.fallbackPolicy ? ` · fallback ${item.fallbackPolicy}` : ''}
                  {item.gatesApplied.length ? ` · gates: ${item.gatesApplied.join(', ')}` : ''}
                  {item.reasonsRu.length ? <div>{item.reasonsRu.join(' ')}</div> : null}
                </li>
              ))}
            </ul>
          ) : <p>Триггеры Safe Mode пока не зафиксированы.</p>}
        </section>

        <section className="panel" aria-label="World map">
          <h2>Карта мира (SVG)</h2>
          {worldMapSnapshot ? <WorldMapView snapshot={worldMapSnapshot} /> : <p>Карта мира готовится…</p>}
        </section>

        <div className="settings-actions">
          <button type="button" onClick={() => {
            const report = { build: import.meta.env.VITE_APP_VERSION ?? 'dev', schemaVersion, stats, settings: { theme: document.documentElement.dataset.theme }, lastErrors: window.localStorage.getItem('gamno.lastError') }
            const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = 'gamno-system-report.json'
            a.click()
            URL.revokeObjectURL(url)
          }}>Экспорт отчёта</button>
          <button type="button" onClick={() => { window.localStorage.removeItem('gamno.multiverseDraft') }}>Очистить кэш воркеров</button>
        </div>
      </article>
    </section>
  )
}
