import { schemaVersion } from '../core/storage/db'
import { db } from '../core/storage/db'
import { getLastFrame } from '../repo/frameRepo'
import { getLatestForecastRun } from '../repo/forecastRepo'
import { getLastBlackSwanRun } from '../repo/blackSwanRepo'
import { getLastRun as getLastMultiverseRun } from '../repo/multiverseRepo'
import { useEffect, useState } from 'react'
import { evaluateModelHealth, type ModelHealthSnapshot } from '../core/engines/analytics/modelHealth'
import { CalibrationTrustCard } from '../ui/components/CalibrationTrust'

interface SystemStats {
  frameTs?: number
  forecastTs?: number
  blackSwanTs?: number
  multiverseTs?: number
  counts: Record<string, number>
  health: { learned: ModelHealthSnapshot; forecast: ModelHealthSnapshot; policy: ModelHealthSnapshot } | null
}

export function SystemPage() {
  const [stats, setStats] = useState<SystemStats>({ counts: {}, health: null })

  useEffect(() => {
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
      db.actionAudits.orderBy('ts').reverse().limit(24).toArray(),
    ]).then(([frame, forecast, blackSwan, multiverse, checkins, events, frames, runs, matrices, forecasts, audits]) => {
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

      const health = {
        learned: evaluateModelHealth({ kind: 'learned', calibration: learnedCalibration, driftSeries: learnedDrift, minSamples: 3 }),
        forecast: evaluateModelHealth({ kind: 'forecast', calibration: forecastCalibration, driftSeries: forecastDrift, minSamples: 8 }),
        policy: policyHealthFromAudit ?? evaluateModelHealth({ kind: 'policy', calibration: policyCalibration, driftSeries: policyDrift, minSamples: 6 }),
      }

      setStats({ frameTs: frame?.ts, forecastTs: forecast?.ts, blackSwanTs: blackSwan?.ts, multiverseTs: multiverse?.ts, counts: { checkins, events, frames, runs }, health })
    })
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
