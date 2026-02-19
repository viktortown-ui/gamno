import { useEffect, useMemo, useState } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import type { CheckinRecord, CheckinValues } from './core/models/checkin'
import type { QuestRecord } from './core/models/quest'
import { getActiveQuest, getLatestCheckin, listCheckins } from './core/storage/repo'
import { CorePage } from './pages/CorePage'
import { DashboardPage } from './pages/DashboardPage'
import { HistoryPage } from './pages/HistoryPage'
import { SettingsPage } from './pages/SettingsPage'
import { OraclePage } from './pages/OraclePage'
import { GraphPage } from './pages/GraphPage'
import { CommandPalette } from './ui/CommandPalette'
import { loadAppearanceSettings, saveAppearanceSettings, type AppearanceSettings } from './ui/appearance'
import { Starfield } from './ui/Starfield'
import { MissionStrip } from './ui/MissionStrip'
import { computeAverages, computeIndexSeries, computeVolatility } from './core/engines/analytics/compute'
import { INDEX_METRIC_IDS } from './core/metrics'
import { evaluateSignals } from './core/engines/rules/evaluateSignals'
import { forecastIndex } from './core/engines/forecast/indexForecast'
import { getLatestForecastRun } from './repo/forecastRepo'

type PageKey = 'core' | 'dashboard' | 'oracle' | 'graph' | 'history' | 'settings'

const pageMeta: { key: PageKey; label: string }[] = [
  { key: 'core', label: 'Живое ядро' },
  { key: 'dashboard', label: 'Дашборд' },
  { key: 'oracle', label: 'Оракул' },
  { key: 'graph', label: 'Граф' },
  { key: 'history', label: 'История' },
  { key: 'settings', label: 'Настройки' },
]

function DesktopOnlyGate() {
  const [isDesktop, setIsDesktop] = useState(window.innerWidth >= 1200)

  useEffect(() => {
    const handleResize = () => setIsDesktop(window.innerWidth >= 1200)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  if (isDesktop) return <DesktopApp />

  return (
    <main className="gate">
      <h1>Только десктоп</h1>
      <p>Откройте приложение на экране шириной не меньше 1200px.</p>
    </main>
  )
}

function DesktopApp() {
  const [checkins, setCheckins] = useState<CheckinRecord[]>([])
  const [latestCheckin, setLatestCheckin] = useState<CheckinRecord | undefined>()
  const [templateValues, setTemplateValues] = useState<CheckinValues | undefined>()
  const [activeQuest, setActiveQuest] = useState<QuestRecord | undefined>()
  const [appearance, setAppearance] = useState<AppearanceSettings>(() => loadAppearanceSettings())
  const [oracleForecast, setOracleForecast] = useState<number>(0)
  const [oracleConfidence, setOracleConfidence] = useState<'низкая' | 'средняя' | 'высокая'>('низкая')

  const loadData = async () => {
    const [all, latest, currentQuest, latestForecast] = await Promise.all([listCheckins(), getLatestCheckin(), getActiveQuest(), getLatestForecastRun()])
    setCheckins(all)
    setLatestCheckin(latest)
    setActiveQuest(currentQuest)
    if (latestForecast) {
      setOracleForecast(latestForecast.index.p50[6] ?? latestForecast.index.p50.at(-1) ?? 0)
      const coverage = latestForecast.backtest.coverage
      setOracleConfidence(coverage >= 75 ? 'высокая' : coverage >= 60 ? 'средняя' : 'низкая')
    }
  }

  useEffect(() => {
    let cancelled = false
    void Promise.all([listCheckins(), getLatestCheckin(), getActiveQuest(), getLatestForecastRun()]).then(([all, latest, currentQuest, latestForecast]) => {
      if (cancelled) return
      setCheckins(all)
      setLatestCheckin(latest)
      setActiveQuest(currentQuest)
      if (latestForecast) {
        setOracleForecast(latestForecast.index.p50[6] ?? latestForecast.index.p50.at(-1) ?? 0)
        const coverage = latestForecast.backtest.coverage
        setOracleConfidence(coverage >= 75 ? 'высокая' : coverage >= 60 ? 'средняя' : 'низкая')
      }
    })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = appearance.theme
    document.documentElement.dataset.motion = appearance.motion
    document.documentElement.dataset.transparency = appearance.transparency
    saveAppearanceSettings(appearance)
  }, [appearance])

  const missionSummary = useMemo(() => {
    if (!checkins.length) {
      return { index: 0, risk: 'нет данных', forecast: 0, signals: 0, volatility: 'нет данных', confidence: 'низкая' as const }
    }

    const indexSeries = computeIndexSeries(checkins)
    const fallbackForecast = forecastIndex(indexSeries)
    const avg7 = computeAverages(checkins, INDEX_METRIC_IDS, 7)
    const riskScore = (avg7.stress ?? 0) - (avg7.sleepHours ?? 0) * 0.5
    const risk = riskScore > 3 ? 'повышенный' : riskScore > 1.5 ? 'средний' : 'низкий'
    const signals = evaluateSignals({
      energyAvg7d: avg7.energy ?? 0,
      stressAvg7d: avg7.stress ?? 0,
      sleepAvg7d: avg7.sleepHours ?? 0,
      indexDelta7d: (indexSeries.at(-1) ?? 0) - (indexSeries.at(-8) ?? indexSeries.at(-1) ?? 0),
    }).length
    const volatilityValue = computeVolatility(checkins, 'energy', 14)
    const volatility = volatilityValue < 0.8 ? 'низкая' : volatilityValue < 1.6 ? 'средняя' : 'высокая'

    return {
      index: indexSeries.at(-1) ?? 0,
      risk,
      forecast: oracleForecast || fallbackForecast.values.at(-1) || 0,
      signals,
      volatility,
      confidence: oracleConfidence,
    }
  }, [checkins, oracleForecast, oracleConfidence])

  return (
    <div className="layout">
      <Starfield />
      <CommandPalette />
      <aside className="sidebar panel">
        <h2>Gamno</h2>
        <nav>
          {pageMeta.map((page) => (
            <NavLink
              key={page.key}
              className={({ isActive }) => `nav-link ${isActive ? 'nav-link--active' : ''}`}
              to={`/${page.key}`}
            >
              {page.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="content">
        <MissionStrip {...missionSummary} activeQuest={activeQuest} />
        <Routes>
          <Route path="/" element={<Navigate to="/core" replace />} />
          <Route
            path="/core"
            element={
              <CorePage
                onSaved={async () => { await loadData() }}
                latest={latestCheckin}
                previous={checkins[1]}
                templateValues={templateValues}
                activeQuest={activeQuest}
                onQuestChange={loadData}
                checkins={checkins}
              />
            }
          />
          <Route path="/dashboard" element={<DashboardPage checkins={checkins} activeQuest={activeQuest} onQuestChange={loadData} />} />
          <Route path="/history" element={<HistoryPage checkins={checkins} onUseTemplate={setTemplateValues} onDataChanged={loadData} />} />
          <Route path="/settings" element={<SettingsPage onDataChanged={loadData} appearance={appearance} onAppearanceChange={setAppearance} />} />
          <Route path="/oracle" element={<OraclePage latest={latestCheckin} onQuestChange={loadData} />} />
          <Route path="/graph" element={<GraphPage />} />
        </Routes>
      </main>
    </div>
  )
}

export default function App() {
  return <DesktopOnlyGate />
}
