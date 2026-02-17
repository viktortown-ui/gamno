import { useEffect, useState } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import type { CheckinRecord, CheckinValues } from './core/models/checkin'
import { getLatestCheckin, listCheckins } from './core/storage/repo'
import { CorePage } from './pages/CorePage'
import { DashboardPage } from './pages/DashboardPage'
import { HistoryPage } from './pages/HistoryPage'
import { SettingsPage } from './pages/SettingsPage'

type PageKey = 'core' | 'dashboard' | 'oracle' | 'graph' | 'history' | 'settings'

const pageMeta: { key: PageKey; label: string }[] = [
  { key: 'core', label: 'Чек-ин' },
  { key: 'dashboard', label: 'Дашборд' },
  { key: 'oracle', label: 'Оракул' },
  { key: 'graph', label: 'График' },
  { key: 'history', label: 'История' },
  { key: 'settings', label: 'Настройки' },
]

function PageStub({ title }: { title: string }) {
  return (
    <section className="page">
      <h1>{title}</h1>
      <p>Страница-заглушка для раздела {title}.</p>
    </section>
  )
}

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

  const loadData = async () => {
    const [all, latest] = await Promise.all([listCheckins(), getLatestCheckin()])
    setCheckins(all)
    setLatestCheckin(latest)
  }

  const handleSaved = async (saved: CheckinRecord) => {
    setLatestCheckin(saved)
    await loadData()
  }

  useEffect(() => {
    void loadData()
  }, [])

  return (
    <div className="layout">
      <aside className="sidebar">
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
                onSaved={handleSaved}
                latest={latestCheckin}
                previous={checkins[1]}
                templateValues={templateValues}
              />
            }
          />
          <Route path="/dashboard" element={<DashboardPage checkins={checkins} />} />
          <Route path="/history" element={<HistoryPage checkins={checkins} onUseTemplate={setTemplateValues} />} />
          <Route path="/settings" element={<SettingsPage onDataChanged={loadData} />} />
          <Route path="/oracle" element={<PageStub title="Оракул" />} />
          <Route path="/graph" element={<PageStub title="График" />} />
        </Routes>
      </main>
    </div>
  )
}

export default function App() {
  return <DesktopOnlyGate />
}
