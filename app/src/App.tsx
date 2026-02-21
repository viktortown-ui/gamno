import { useEffect, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import type { CheckinRecord, CheckinValues } from './core/models/checkin'
import type { QuestRecord } from './core/models/quest'
import { getActiveQuest, getLatestCheckin, listCheckins } from './core/storage/repo'
import { CorePage } from './pages/CorePage'
import { DashboardPage } from './pages/DashboardPage'
import { HistoryPage } from './pages/HistoryPage'
import { SettingsPage } from './pages/SettingsPage'
import { OraclePage } from './pages/OraclePage'
import { GraphPage } from './pages/GraphPage'
import { GoalsPage } from './pages/GoalsPage'
import { MultiversePage } from './pages/MultiversePage'
import { CommandPalette } from './ui/CommandPalette'
import { loadAppearanceSettings, saveAppearanceSettings, type AppearanceSettings } from './ui/appearance'
import { Starfield } from './ui/Starfield'
import { BlackSwansPage } from './pages/BlackSwansPage'
import { SocialRadarPage } from './pages/SocialRadarPage'
import { TimeDebtPage } from './pages/TimeDebtPage'
import { AutopilotPage } from './pages/AutopilotPage'
import { AntifragilityPage } from './pages/AntifragilityPage'
import { StartPage } from './pages/StartPage'
import { SystemPage } from './pages/SystemPage'
import { WorldPage } from './pages/WorldPage'
import { computeAndSaveFrame, getLastFrame, type FrameSnapshotRecord } from './repo/frameRepo'

type PageKey = 'start' | 'world' | 'core' | 'dashboard' | 'oracle' | 'autopilot' | 'antifragility' | 'multiverse' | 'time-debt' | 'social-radar' | 'black-swans' | 'goals' | 'graph' | 'history' | 'settings' | 'system'

const pageMeta: { key: PageKey; label: string; icon?: string }[] = [
  { key: 'world', label: 'Мир', icon: '◉' },
  { key: 'start', label: 'Помощь', icon: '?' },
  { key: 'core', label: 'Живое ядро' },
  { key: 'dashboard', label: 'Дашборд' },
  { key: 'oracle', label: 'Оракул' },
  { key: 'autopilot', label: 'Автопилот' },
  { key: 'antifragility', label: 'Антихрупкость' },
  { key: 'multiverse', label: 'Мультивселенная' },
  { key: 'time-debt', label: 'Долг' },
  { key: 'social-radar', label: 'Социальный радар' },
  { key: 'black-swans', label: 'Чёрные лебеди' },
  { key: 'goals', label: 'Цели' },
  { key: 'graph', label: 'Граф' },
  { key: 'history', label: 'История' },
  { key: 'settings', label: 'Настройки' },
  { key: 'system', label: 'Система', icon: '⌁' },
]

function DesktopOnlyGate() {
  const [isDesktop, setIsDesktop] = useState(window.innerWidth >= 1200)
  useEffect(() => {
    const handleResize = () => setIsDesktop(window.innerWidth >= 1200)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])
  if (isDesktop) return <DesktopApp />
  return <main className="gate"><h1>Только десктоп</h1><p>Откройте приложение на экране шириной не меньше 1200px.</p></main>
}

function DesktopApp() {
  const location = useLocation()
  const [checkins, setCheckins] = useState<CheckinRecord[]>([])
  const [latestCheckin, setLatestCheckin] = useState<CheckinRecord | undefined>()
  const [templateValues, setTemplateValues] = useState<CheckinValues | undefined>()
  const [activeQuest, setActiveQuest] = useState<QuestRecord | undefined>()
  const [appearance, setAppearance] = useState<AppearanceSettings>(() => loadAppearanceSettings())
  const [frame, setFrame] = useState<FrameSnapshotRecord | undefined>()
  const [hintsEnabled, setHintsEnabled] = useState(false)
  const [navExpanded, setNavExpanded] = useState(false)

  const loadData = async () => {
    const [all, latest, currentQuest] = await Promise.all([listCheckins(), getLatestCheckin(), getActiveQuest()])
    setCheckins(all)
    setLatestCheckin(latest)
    setActiveQuest(currentQuest)
    const lastFrame = await getLastFrame()
    if (lastFrame) {
      setFrame(lastFrame)
    } else {
      setFrame(await computeAndSaveFrame())
    }
  }

  useEffect(() => {
    let cancelled = false
    void Promise.resolve().then(async () => {
      if (cancelled) return
      await loadData()
    })
    return () => { cancelled = true }
  }, [])
  useEffect(() => {
    document.documentElement.dataset.theme = appearance.theme
    document.documentElement.dataset.motion = appearance.motion
    document.documentElement.dataset.transparency = appearance.transparency
    saveAppearanceSettings(appearance)
  }, [appearance])

  const isWorldHomeRoute = location.pathname === '/world' || location.pathname === '/start'
  const collapseSidebar = isWorldHomeRoute && !navExpanded

  return (
    <div className={`layout ${hintsEnabled && location.pathname === '/start' ? 'layout--hints' : ''} ${collapseSidebar ? 'layout--sidebar-collapsed' : ''}`.trim()}>
      <Starfield />
      <CommandPalette />
      <aside className="sidebar panel">
        <div className="sidebar__head">
          <h2>Gamno</h2>
          {isWorldHomeRoute ? (
            <button type="button" className="sidebar__toggle" onClick={() => setNavExpanded((prev) => !prev)} aria-label={collapseSidebar ? 'Показать меню' : 'Свернуть меню'}>
              {collapseSidebar ? '☰' : '←'}
            </button>
          ) : null}
        </div>
        <nav>
          {pageMeta.map((page) => (
            <NavLink key={page.key} className={({ isActive }) => `nav-link ${isActive ? 'nav-link--active' : ''}`} to={`/${page.key}`} data-help-target={page.key === 'world' ? 'nav-world' : page.key === 'start' ? 'nav-start' : undefined}>
              <span className="nav-link__icon" aria-hidden="true">{page.icon ?? page.label[0] ?? "•"}</span>
              <span className="nav-link__label">{page.label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="content">
        <Routes>
          <Route path="/" element={<Navigate to="/world" replace />} />
          <Route path="/start" element={<StartPage onDone={loadData} hintsEnabled={hintsEnabled} onHintsChange={setHintsEnabled} />} />
          <Route path="/launch" element={<Navigate to="/start" replace />} />
          <Route path="/world" element={<WorldPage uiVariant={appearance.worldUiVariant} />} />
          <Route path="/map" element={<Navigate to="/world" replace />} />
          <Route path="/core" element={<CorePage onSaved={loadData} latest={latestCheckin} previous={checkins[1]} templateValues={templateValues} activeQuest={activeQuest} onQuestChange={loadData} checkins={checkins} activeGoalSummary={frame ? { title: frame.payload.goal.active?.title ?? 'Цель', score: frame.payload.goal.goalScore, gap: frame.payload.goal.gap, trend: null } : null} />} />
          <Route path="/dashboard" element={<DashboardPage checkins={checkins} activeQuest={activeQuest} onQuestChange={loadData} />} />
          <Route path="/history" element={<HistoryPage checkins={checkins} onUseTemplate={setTemplateValues} onDataChanged={loadData} />} />
          <Route path="/settings" element={<SettingsPage onDataChanged={loadData} appearance={appearance} onAppearanceChange={setAppearance} />} />
          <Route path="/oracle" element={<OraclePage latest={latestCheckin} onQuestChange={loadData} />} />
          <Route path="/autopilot" element={<AutopilotPage onChanged={loadData} />} />
          <Route path="/antifragility" element={<AntifragilityPage onQuestChange={loadData} />} />
          <Route path="/goals" element={<GoalsPage />} />
          <Route path="/multiverse" element={<MultiversePage />} />
          <Route path="/social-radar" element={<SocialRadarPage />} />
          <Route path="/time-debt" element={<TimeDebtPage onQuestChange={loadData} />} />
          <Route path="/black-swans" element={<BlackSwansPage />} />
          <Route path="/graph" element={<GraphPage />} />
          <Route path="/system" element={<SystemPage />} />
        </Routes>
      </main>
    </div>
  )
}

export default function App() {
  return <DesktopOnlyGate />
}
