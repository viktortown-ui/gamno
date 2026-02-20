import { schemaVersion } from '../core/storage/db'
import { db } from '../core/storage/db'
import { getLastFrame } from '../repo/frameRepo'
import { getLatestForecastRun } from '../repo/forecastRepo'
import { getLastBlackSwanRun } from '../repo/blackSwanRepo'
import { getLastRun as getLastMultiverseRun } from '../repo/multiverseRepo'
import { useEffect, useState } from 'react'

interface SystemStats {
  frameTs?: number
  forecastTs?: number
  blackSwanTs?: number
  multiverseTs?: number
  counts: Record<string, number>
}

export function SystemPage() {
  const [stats, setStats] = useState<SystemStats>({ counts: {} })

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
    ]).then(([frame, forecast, blackSwan, multiverse, checkins, events, frames, runs]) => {
      setStats({ frameTs: frame?.ts, forecastTs: forecast?.ts, blackSwanTs: blackSwan?.ts, multiverseTs: multiverse?.ts, counts: { checkins, events, frames, runs } })
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
