import { useEffect, useMemo, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
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
import { MissionStrip } from './ui/MissionStrip'
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

const pageMeta: { key: PageKey; label: string }[] = [
  { key: 'start', label: 'Запуск' },
  { key: 'world', label: 'Мир' },
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
  { key: 'system', label: 'Система' },
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
  const navigate = useNavigate()
  const location = useLocation()
  const [checkins, setCheckins] = useState<CheckinRecord[]>([])
  const [latestCheckin, setLatestCheckin] = useState<CheckinRecord | undefined>()
  const [templateValues, setTemplateValues] = useState<CheckinValues | undefined>()
  const [activeQuest, setActiveQuest] = useState<QuestRecord | undefined>()
  const [appearance, setAppearance] = useState<AppearanceSettings>(() => loadAppearanceSettings())
  const [frame, setFrame] = useState<FrameSnapshotRecord | undefined>()
  const [hintsEnabled, setHintsEnabled] = useState(false)
  const [bootstrapped, setBootstrapped] = useState(false)

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
      if (!cancelled) setBootstrapped(true)
    })
    return () => { cancelled = true }
  }, [])
  useEffect(() => {
    document.documentElement.dataset.theme = appearance.theme
    document.documentElement.dataset.motion = appearance.motion
    document.documentElement.dataset.transparency = appearance.transparency
    saveAppearanceSettings(appearance)
  }, [appearance])

  const missionSummary = useMemo(() => {
    const payload = frame?.payload
    return {
      index: payload?.stateSnapshot.index ?? 0,
      risk: (payload?.stateSnapshot.risk ?? 0) >= 3 ? 'повышенный' : (payload?.stateSnapshot.risk ?? 0) >= 1.5 ? 'средний' : 'низкий',
      forecast: payload?.forecastSummary.p50next7 ?? 0,
      signals: payload?.regimeSnapshot.explainTop3.length ?? 0,
      volatility: (payload?.stateSnapshot.volatility ?? 0) > 1.6 ? 'высокая' : (payload?.stateSnapshot.volatility ?? 0) > 0.8 ? 'средняя' : 'низкая',
      confidence: payload?.forecastSummary.confidence ?? 'низкая' as const,
      regimeId: (payload?.regimeSnapshot.regimeId ?? 0) as 0 | 1 | 2 | 3 | 4,
      pCollapse: payload?.regimeSnapshot.pCollapse ?? 0,
      sirenLevel: payload?.regimeSnapshot.sirenLevel ?? 'green' as const,
    }
  }, [frame])

  const hasSeenStart = typeof window !== 'undefined' && window.localStorage.getItem('hasSeenStart') === '1'
  const shouldAutoStart = bootstrapped && (!hasSeenStart || checkins.length === 0 || !frame)

  useEffect(() => {
    if (checkins.length > 0) window.localStorage.setItem('hasSeenStart', '1')
  }, [checkins.length])

  useEffect(() => {
    if (!shouldAutoStart || location.pathname === '/start') return
    navigate('/start', { replace: true })
  }, [location.pathname, navigate, shouldAutoStart])

  return (
    <div className={`layout ${hintsEnabled && location.pathname === '/start' ? 'layout--hints' : ''}`.trim()}>
      <Starfield />
      <CommandPalette />
      <aside className="sidebar panel">
        <h2>Gamno</h2>
        <nav>
          {pageMeta.map((page) => (
            <NavLink key={page.key} className={({ isActive }) => `nav-link ${isActive ? 'nav-link--active' : ''}`} to={`/${page.key}`} data-help-target={page.key === 'world' ? 'nav-world' : page.key === 'start' ? 'nav-start' : undefined}>{page.label}</NavLink>
          ))}
        </nav>
      </aside>

      <main className="content">
        <MissionStrip
          {...missionSummary}
          activeQuest={activeQuest}
          goalSummary={frame ? { score: frame.payload.goal.goalScore, trend: null } : null}
          tailRisk={frame ? { pRed7d: frame.payload.tailRiskSummary.pRed7d, esCollapse10: frame.payload.tailRiskSummary.esCollapse10 ?? 0 } : null}
          socialTop3={(frame?.payload.socialSummary.topInfluencesWeek ?? []).map((text) => ({ metric: 'all', text }))}
          debtSummary={frame ? { totalDebt: frame.payload.debt.totalDebt, trend: frame.payload.debt.trend } : null}
          autopilotSummary={frame?.payload.autopilotSummary.policy ? { policyRu: frame.payload.autopilotSummary.policy, nextActionRu: frame.payload.autopilotSummary.nextAction ?? '—' } : null}
          recoverySummary={frame ? { score: frame.payload.antifragility.recoveryScore, trend: 'flat' } : null}
        />
        <Routes>
          <Route path="/" element={<Navigate to={shouldAutoStart ? '/start' : '/world'} replace />} />
          <Route path="/start" element={<StartPage onDone={loadData} hintsEnabled={hintsEnabled} onHintsChange={setHintsEnabled} />} />
          <Route path="/launch" element={<Navigate to="/start" replace />} />
          <Route path="/world" element={<WorldPage />} />
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
