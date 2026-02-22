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

type NavItem = { key: PageKey; label: string; icon: string }

const primaryNavItems: NavItem[] = [
  { key: 'world', label: 'Мир', icon: '◎' },
  { key: 'start', label: 'Старт', icon: '◈' },
  { key: 'core', label: 'Ядро', icon: '◉' },
  { key: 'dashboard', label: 'Дашборд', icon: '▦' },
  { key: 'oracle', label: 'Оракул', icon: '✶' },
  { key: 'goals', label: 'Цели', icon: '◌' },
  { key: 'history', label: 'Лента', icon: '◷' },
]

const secondaryNavItems: NavItem[] = [
  { key: 'autopilot', label: 'Автопилот', icon: '⌁' },
  { key: 'antifragility', label: 'Антихрупкость', icon: '⛨' },
  { key: 'multiverse', label: 'Мульти', icon: '◍' },
  { key: 'time-debt', label: 'Долг', icon: '◔' },
  { key: 'social-radar', label: 'Соцрадар', icon: '⌖' },
  { key: 'black-swans', label: 'Лебеди', icon: '✷' },
  { key: 'graph', label: 'Граф', icon: '⋰' },
  { key: 'settings', label: 'Настройки', icon: '⚙' },
  { key: 'system', label: 'Система', icon: '⌬' },
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
  const [isRailCollapsed, setIsRailCollapsed] = useState(false)
  const [isMoreOpen, setIsMoreOpen] = useState(false)

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
    if (!isMoreOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMoreOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isMoreOpen])

  useEffect(() => {
    document.documentElement.dataset.theme = appearance.theme
    document.documentElement.dataset.motion = appearance.motion
    document.documentElement.dataset.transparency = appearance.transparency
    saveAppearanceSettings(appearance)
  }, [appearance])

  const collapseSidebar = isRailCollapsed

  const renderNavLink = (page: NavItem) => (
    <NavLink
      key={page.key}
      className={({ isActive }) => `nav-link ${isActive ? 'nav-link--active' : ''}`}
      to={`/${page.key}`}
      title={collapseSidebar ? page.label : undefined}
      onClick={() => setIsMoreOpen(false)}
      data-help-target={page.key === 'world' ? 'nav-world' : page.key === 'start' ? 'nav-start' : undefined}
      aria-label={page.label}
      data-tooltip={collapseSidebar ? page.label : undefined}
    >
      <span className="nav-link__icon" aria-hidden="true">{page.icon}</span>
      <span className="nav-link__label">{page.label}</span>
    </NavLink>
  )

  return (
    <div className={`layout ${hintsEnabled && location.pathname === '/start' ? 'layout--hints' : ''} ${collapseSidebar ? 'layout--sidebar-collapsed' : ''}`.trim()}>
      <Starfield />
      <CommandPalette />
      <aside className="sidebar panel" data-testid="navigation-rail">
        <div className="sidebar__head">
          <h2>Gamno</h2>
          <button type="button" className="sidebar__toggle" onClick={() => setIsRailCollapsed((prev) => !prev)} aria-label={collapseSidebar ? 'Развернуть навигацию' : 'Свернуть навигацию'}>
            {collapseSidebar ? '☰' : '←'}
          </button>
        </div>
        <nav role="navigation" aria-label="Навигация" tabIndex={0}>
          {primaryNavItems.map(renderNavLink)}
          <div className="nav-more">
            <button
              type="button"
              className={`nav-link nav-link--button ${isMoreOpen ? 'nav-link--active' : ''}`}
              onClick={() => setIsMoreOpen((prev) => !prev)}
              aria-expanded={isMoreOpen}
              aria-controls="rail-more-list"
              title={collapseSidebar ? 'Ещё' : undefined}
            >
              <span className="nav-link__icon" aria-hidden="true">⋯</span>
              <span className="nav-link__label">Ещё</span>
            </button>
            {isMoreOpen ? (
              <div id="rail-more-list" className="nav-more__list" role="menu" aria-label="Дополнительные разделы">
                {secondaryNavItems.map(renderNavLink)}
              </div>
            ) : null}
          </div>
        </nav>
      </aside>

      <main className="content">
        <Routes>
          <Route path="/" element={<Navigate to="/world" replace />} />
          <Route path="/start" element={<StartPage onDone={loadData} hintsEnabled={hintsEnabled} onHintsChange={setHintsEnabled} />} />
          <Route path="/launch" element={<Navigate to="/start" replace />} />
          <Route path="/world" element={<WorldPage uiVariant={appearance.worldUiVariant} renderMode={appearance.worldRenderMode} />} />
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
