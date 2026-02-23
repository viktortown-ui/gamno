import { useEffect, useMemo, useState } from 'react'
import {
  FloatingFocusManager,
  FloatingOverlay,
  FloatingPortal,
  flip,
  offset,
  shift,
  autoUpdate,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from '@floating-ui/react'
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

type SecondaryNavGroup = {
  title: string
  items: NavItem[]
}

const primaryNavItems: NavItem[] = [
  { key: 'start', label: 'Приветствие / Старт', icon: '◈' },
  { key: 'world', label: 'Мир', icon: '◎' },
  { key: 'core', label: 'Ядро', icon: '◉' },
  { key: 'dashboard', label: 'Дашборд', icon: '▦' },
  { key: 'oracle', label: 'Оракул', icon: '✶' },
  { key: 'goals', label: 'Цели', icon: '◌' },
  { key: 'history', label: 'Лента', icon: '◷' },
]

const secondaryNavGroups: SecondaryNavGroup[] = [
  {
    title: 'Модули',
    items: [
      { key: 'autopilot', label: 'Автопилот', icon: '⌁' },
      { key: 'antifragility', label: 'Антихрупкость', icon: '⛨' },
      { key: 'multiverse', label: 'Мульти', icon: '◍' },
      { key: 'time-debt', label: 'Долг', icon: '◔' },
      { key: 'social-radar', label: 'Соцрадар', icon: '⌖' },
      { key: 'black-swans', label: 'Лебеди', icon: '✷' },
      { key: 'graph', label: 'Граф', icon: '⋰' },
    ],
  },
  {
    title: 'Сервис',
    items: [
      { key: 'settings', label: 'Настройки', icon: '⚙' },
      { key: 'system', label: 'Система', icon: '⌬' },
    ],
  },
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
  const [moreSearch, setMoreSearch] = useState('')
  const [moreReferenceEl, setMoreReferenceEl] = useState<HTMLButtonElement | null>(null)
  const [moreFloatingEl, setMoreFloatingEl] = useState<HTMLDivElement | null>(null)
  const { floatingStyles, context } = useFloating({
    elements: {
      reference: moreReferenceEl,
      floating: moreFloatingEl,
    },
    open: isMoreOpen,
    onOpenChange: (open) => {
      setIsMoreOpen(open)
      if (!open) setMoreSearch('')
    },
    placement: 'right-start',
    whileElementsMounted: autoUpdate,
    middleware: [offset(8), flip(), shift({ padding: 8 })],
  })

  const click = useClick(context)
  const dismiss = useDismiss(context)
  const role = useRole(context, { role: 'dialog' })
  const { getReferenceProps, getFloatingProps } = useInteractions([click, dismiss, role])

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
    const onToggleRailShortcut = (event: KeyboardEvent) => {
      const isBracketShortcut = event.key === '[' && !event.shiftKey
      const isCtrlBShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b'
      if (!isBracketShortcut && !isCtrlBShortcut) return
      const targetTag = event.target instanceof HTMLElement ? event.target.tagName : ''
      if (targetTag === 'INPUT' || targetTag === 'TEXTAREA') return
      event.preventDefault()
      setIsRailCollapsed((prev) => !prev)
      setIsMoreOpen(false)
    }
    window.addEventListener('keydown', onToggleRailShortcut)
    return () => window.removeEventListener('keydown', onToggleRailShortcut)
  }, [])

  useEffect(() => {
    const resolvedTheme = appearance.theme === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : appearance.theme
    document.documentElement.dataset.theme = resolvedTheme
    document.documentElement.dataset.motion = appearance.motion
    document.documentElement.dataset.transparency = appearance.transparency
    document.documentElement.dataset.uiPreset = appearance.uiPreset
    document.documentElement.dataset.accent = appearance.accentColor
    document.documentElement.dataset.density = appearance.density
    document.documentElement.dataset.fx = appearance.fxEnabled ? 'on' : 'off'
    window.localStorage.setItem('worldLookPreset', appearance.worldLookPreset)
    window.localStorage.setItem('worldQuality', appearance.worldQuality)
    saveAppearanceSettings(appearance)
  }, [appearance])
  const collapseSidebar = isRailCollapsed

  const filteredSecondaryGroups = useMemo(() => {
    const query = moreSearch.trim().toLowerCase()
    if (!query) return secondaryNavGroups
    return secondaryNavGroups
      .map((group) => ({ ...group, items: group.items.filter((item) => item.label.toLowerCase().includes(query)) }))
      .filter((group) => group.items.length > 0)
  }, [moreSearch])

  const renderNavLink = (page: NavItem, compact = false) => (
    <NavLink
      key={page.key}
      end
      className={({ isActive }) => `nav-link ${compact ? 'nav-link--compact' : ''} ${isActive ? 'nav-link--active' : ''}`.trim()}
      to={`/${page.key}`}
      title={collapseSidebar ? page.label : undefined}
      onClick={() => {
        setIsMoreOpen(false)
        setMoreSearch('')
      }}
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
          <div className="sidebar__brand">
            <h2>ConcoreR</h2>
            <p className="sidebar__subtitle">Контур Ядра</p>
          </div>
          <button
            type="button"
            className="sidebar__toggle"
            onClick={() => {
              setIsRailCollapsed((prev) => !prev)
              setIsMoreOpen(false)
              setMoreSearch('')
            }}
            aria-label={collapseSidebar ? 'Развернуть навигацию' : 'Свернуть навигацию'}
            title="Свернуть / развернуть (Ctrl+B или [)"
          >
            {collapseSidebar ? '☰' : '←'}
          </button>
        </div>
        <nav role="navigation" aria-label="Навигация" tabIndex={0}>
          {primaryNavItems.map((item) => renderNavLink(item))}
          <div className="nav-more" data-testid="nav-more-flyout-root">
            <button
              type="button"
              className={`nav-link nav-link--button ${isMoreOpen ? 'nav-link--active' : ''}`}
              ref={setMoreReferenceEl}
              {...getReferenceProps()}
              aria-expanded={isMoreOpen}
              aria-controls={isMoreOpen ? 'rail-more-list' : undefined}
              title={collapseSidebar ? 'Ещё' : undefined}
              data-tooltip={collapseSidebar ? 'Ещё' : undefined}
            >
              <span className="nav-link__icon" aria-hidden="true">⋯</span>
              <span className="nav-link__label">Ещё</span>
            </button>
            {isMoreOpen ? (
              <FloatingPortal>
                <FloatingOverlay lockScroll={false} className="nav-more__overlay" style={{ left: collapseSidebar ? 96 : 286 }} />
                <FloatingFocusManager context={context} modal={false} initialFocus={-1} returnFocus>
                  <div
                    id="rail-more-list"
                    className="nav-more__popover"
                    ref={setMoreFloatingEl}
                    style={floatingStyles}
                    aria-label="Ещё"
                    {...getFloatingProps()}
                  >
                    <h3 className="nav-more__title">Ещё</h3>
                    <div className="nav-more__search-wrap">
                      <input
                        type="search"
                        className="nav-more__search"
                        placeholder="Поиск модуля"
                        value={moreSearch}
                        onChange={(event) => setMoreSearch(event.target.value)}
                        aria-label="Поиск по дополнительным разделам"
                      />
                    </div>
                    {filteredSecondaryGroups.map((group) => (
                      <section key={group.title} className="nav-more__group" aria-label={group.title}>
                        <h4>{group.title}</h4>
                        <div className="nav-more__list" role="menu" aria-label={group.title}>
                          {group.items.map((item) => renderNavLink(item, true))}
                        </div>
                      </section>
                    ))}
                    {filteredSecondaryGroups.length === 0 ? <p className="nav-more__empty">Ничего не найдено</p> : null}
                  </div>
                </FloatingFocusManager>
              </FloatingPortal>
            ) : null}
          </div>
        </nav>
      </aside>

      <main className="content">
        <Routes>
          <Route path="/" element={<Navigate to="/world" replace />} />
          <Route path="/start" element={<StartPage onDone={loadData} hintsEnabled={hintsEnabled} onHintsChange={setHintsEnabled} uiPreset={appearance.uiPreset} worldLookPreset={appearance.worldLookPreset} />} />
          <Route path="/launch" element={<Navigate to="/start" replace />} />
          <Route path="/world" element={<WorldPage uiVariant={appearance.worldUiVariant} renderMode={appearance.worldRenderMode} lookPreset={appearance.worldLookPreset} />} />
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
