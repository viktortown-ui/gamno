import { useEffect, useState } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import type { CheckinRecord, CheckinValues } from './core/models/checkin'
import { getLatestCheckin, listCheckins } from './core/storage/repo'
import { CorePage } from './pages/CorePage'
import { DashboardPage } from './pages/DashboardPage'
import { HistoryPage } from './pages/HistoryPage'
import { SettingsPage } from './pages/SettingsPage'
import { OraclePage } from './pages/OraclePage'
import { GraphPage } from './pages/GraphPage'
import { CommandPalette } from './ui/CommandPalette'
import { loadAppearanceSettings, saveAppearanceSettings, type AppearanceSettings } from './ui/appearance'
import { Starfield } from './ui/Starfield'

type PageKey = 'core' | 'dashboard' | 'oracle' | 'graph' | 'history' | 'settings'

const pageMeta: { key: PageKey; label: string }[] = [
  { key: 'core', label: 'Чек-ин' },
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
  const [appearance, setAppearance] = useState<AppearanceSettings>(() => loadAppearanceSettings())

  const loadData = async () => {
    const [all, latest] = await Promise.all([listCheckins(), getLatestCheckin()])
    setCheckins(all)
    setLatestCheckin(latest)
  }

  useEffect(() => {
    void loadData()
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = appearance.theme
    document.documentElement.dataset.motion = appearance.motion
    saveAppearanceSettings(appearance)
  }, [appearance])

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
              />
            }
          />
          <Route path="/dashboard" element={<DashboardPage checkins={checkins} />} />
          <Route path="/history" element={<HistoryPage checkins={checkins} onUseTemplate={setTemplateValues} onDataChanged={loadData} />} />
          <Route path="/settings" element={<SettingsPage onDataChanged={loadData} appearance={appearance} onAppearanceChange={setAppearance} />} />
          <Route path="/oracle" element={<OraclePage latest={latestCheckin} />} />
          <Route path="/graph" element={<GraphPage />} />
        </Routes>
      </main>
    </div>
  )
}

export default function App() {
  return <DesktopOnlyGate />
}
