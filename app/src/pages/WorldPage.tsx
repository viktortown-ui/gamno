import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { db } from '../core/storage/db'
import { buildUnifiedActionCatalog } from '../core/actions/catalog'
import type { ActionDomain } from '../core/actions/types'
import { PlanetPanel, type PlanetLever } from '../ui/components/PlanetPanel'
import { WorldMapView } from '../ui/components/WorldMapView'
import { createWorldMapWorker, runWorldMapInWorker, type WorldMapWorkerMessage } from '../core/workers/worldMapClient'
import type { WorldMapSnapshot } from '../core/worldMap/types'
import type { FrameSnapshot } from '../core/frame/frameEngine'
import { buildFrameSnapshot } from '../core/frame/frameEngine'
import type { HorizonAuditSummaryRecord } from '../repo/actionAuditRepo'
import { buildWorldFxEvents, mapFrameToHudSignals } from './worldCockpit'

const DEFAULT_WORLD_MAP_FRAME: FrameSnapshot = buildFrameSnapshot({ nowTs: Date.UTC(2026, 0, 1) })
const WORLD_ROUTE = '/world'
const MAX_TIMELINE_FRAMES = 30

const DOMAIN_BY_PLANET: Record<string, ActionDomain> = {
  core: 'фокус',
  risk: 'восстановление',
  mission: 'карьера',
  stability: 'финансы',
  forecast: 'фокус',
  social: 'социальное',
}

function sortLevers(a: HorizonAuditSummaryRecord, b: HorizonAuditSummaryRecord): number {
  return (b.stats.p50 - a.stats.p50)
    || (b.stats.p90 - a.stats.p90)
    || ((a.stats.es97_5 ?? Number.POSITIVE_INFINITY) - (b.stats.es97_5 ?? Number.POSITIVE_INFINITY))
    || (a.stats.failRate - b.stats.failRate)
    || a.policyMode.localeCompare(b.policyMode)
    || a.actionId.localeCompare(b.actionId)
}

function getHashPlanetId(): string | null {
  const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash
  const [path, query] = hash.split('?')
  if (path !== WORLD_ROUTE || !query) return null
  const params = new URLSearchParams(query)
  return params.get('planet')
}

function setHashPlanetId(planetId: string | null): void {
  const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '')
  if (planetId) params.set('planet', planetId)
  else params.delete('planet')
  const query = params.toString()
  window.location.hash = query ? `${WORLD_ROUTE}?${query}` : WORLD_ROUTE
}

export function WorldPage() {
  const navigate = useNavigate()
  const [worldMapSnapshot, setWorldMapSnapshot] = useState<WorldMapSnapshot | null>(null)
  const [frames, setFrames] = useState<Array<{ ts: number; payload: FrameSnapshot }>>([])
  const [timelineIndex, setTimelineIndex] = useState(0)
  const [horizonSummary, setHorizonSummary] = useState<HorizonAuditSummaryRecord[]>([])
  const [whyTopRu, setWhyTopRu] = useState<string[]>([])
  const [debtProtocol, setDebtProtocol] = useState<string[]>([])
  const [modelTrust, setModelTrust] = useState('n/a')
  const [trustReason, setTrustReason] = useState('Нет данных.')
  const [policyMode, setPolicyMode] = useState('balanced')
  const [selectedPlanetId, setSelectedPlanetId] = useState<string | null>(() => getHashPlanetId())
  const [lastActionReason, setLastActionReason] = useState('Сделайте первый шаг: чек-ин или автопилот.')
  const lastOriginRef = useRef<HTMLElement | null>(null)
  const prevSelectedRef = useRef<string | null>(selectedPlanetId)

  useEffect(() => {
    const syncFromHash = () => setSelectedPlanetId(getHashPlanetId())
    window.addEventListener('hashchange', syncFromHash)
    return () => window.removeEventListener('hashchange', syncFromHash)
  }, [])

  useEffect(() => {
    const prev = prevSelectedRef.current
    if (prev && !selectedPlanetId) {
      lastOriginRef.current?.focus()
      lastOriginRef.current = null
    }
    prevSelectedRef.current = selectedPlanetId
  }, [selectedPlanetId])

  useEffect(() => {
    const worldMapWorker = createWorldMapWorker((message: WorldMapWorkerMessage) => {
      if (message.type === 'done') setWorldMapSnapshot(message.result)
    })

    void Promise.all([
      db.frameSnapshots.orderBy('ts').reverse().limit(MAX_TIMELINE_FRAMES).toArray(),
      db.actionAudits.orderBy('ts').reverse().limit(36).toArray(),
    ]).then(([frameRows, audits]) => {
      const timeline = frameRows
        .slice()
        .sort((a, b) => (a.ts - b.ts) || ((a.id ?? 0) - (b.id ?? 0)))
        .map((row) => ({ ts: row.ts, payload: row.payload }))
      setFrames(timeline)
      setTimelineIndex(Math.max(0, timeline.length - 1))

      const latest = timeline[timeline.length - 1]?.payload ?? DEFAULT_WORLD_MAP_FRAME
      runWorldMapInWorker(worldMapWorker, {
        frame: latest,
        seed: 12,
        viewport: { width: 1600, height: 860, padding: 24 },
      })

      const lastAudit = audits[0]
      setHorizonSummary(lastAudit?.horizonSummary ?? [])
      setWhyTopRu(lastAudit?.whyTopRu ?? [])
      setDebtProtocol((latest.debt.protocol ?? []).slice(0, 4))
      setModelTrust(lastAudit?.modelHealth?.grade ?? 'n/a')
      setTrustReason(lastAudit?.modelHealth?.reasonsRu?.[0] ?? 'Нет свежей диагностики.')
      setPolicyMode(lastAudit?.horizonSummary?.[0]?.policyMode ?? 'balanced')
      setLastActionReason(lastAudit?.whyTopRu?.[0] ?? 'Действие пока не выбрано.')
    })

    return () => worldMapWorker.terminate()
  }, [])

  const replayFrame = frames[timelineIndex]?.payload ?? DEFAULT_WORLD_MAP_FRAME

  useEffect(() => {
    const worldMapWorker = createWorldMapWorker((message: WorldMapWorkerMessage) => {
      if (message.type === 'done') setWorldMapSnapshot(message.result)
    })
    runWorldMapInWorker(worldMapWorker, {
      frame: replayFrame,
      seed: 12,
      viewport: { width: 1600, height: 860, padding: 24 },
    })
    return () => worldMapWorker.terminate()
  }, [replayFrame])

  const selectedPlanet = useMemo(() => worldMapSnapshot?.planets.find((planet) => planet.id === selectedPlanetId) ?? null, [selectedPlanetId, worldMapSnapshot])
  const currentFrame = frames[timelineIndex]?.payload ?? DEFAULT_WORLD_MAP_FRAME
  const previousFrame = timelineIndex > 0 ? frames[timelineIndex - 1]?.payload : undefined

  const panelLevers = useMemo((): PlanetLever[] => {
    if (!selectedPlanet) return []
    const catalog = buildUnifiedActionCatalog()
    const actionMap = new Map(catalog.map((item) => [item.id, item]))
    const domain = DOMAIN_BY_PLANET[selectedPlanet.domainId]
    return horizonSummary
      .filter((item) => item.horizonDays === 7)
      .filter((item) => actionMap.get(item.actionId)?.domain === domain)
      .sort(sortLevers)
      .slice(0, 4)
      .map((item) => {
        const action = actionMap.get(item.actionId)
        return {
          actionId: item.actionId,
          titleRu: action?.titleRu ?? item.actionId,
          p50: item.stats.p50,
          p90: item.stats.p90,
          es97_5: item.stats.es97_5 ?? item.stats.tail,
          failRate: item.stats.failRate,
          ctaRu: action?.tags.includes('goal') ? 'Собрать миссию' : 'Сделать',
          costRu: `~${action?.defaultCost.timeMin ?? 0} мин · E${action?.defaultCost.energy ?? 0}`,
        }
      })
  }, [horizonSummary, selectedPlanet])

  const bestAction = useMemo(() => {
    const catalog = buildUnifiedActionCatalog()
    const actionMap = new Map(catalog.map((item) => [item.id, item]))
    const best = horizonSummary
      .filter((item) => item.horizonDays === 7)
      .sort(sortLevers)[0]
    if (!best) return null
    return {
      id: best.actionId,
      titleRu: actionMap.get(best.actionId)?.titleRu ?? best.actionId,
    }
  }, [horizonSummary])

  const topActions = useMemo(() => {
    const catalog = buildUnifiedActionCatalog()
    const actionMap = new Map(catalog.map((item) => [item.id, item]))
    return horizonSummary
      .filter((item) => item.horizonDays === 7)
      .sort(sortLevers)
      .slice(0, 3)
      .map((item) => ({
        id: item.actionId,
        titleRu: actionMap.get(item.actionId)?.titleRu ?? item.actionId,
        failRate: item.stats.failRate,
      }))
  }, [horizonSummary])

  const hudSignals = mapFrameToHudSignals({
    frame: currentFrame,
    mode: policyMode,
    failRate: bestAction ? (horizonSummary.find((item) => item.actionId === bestAction.id && item.horizonDays === 7)?.stats.failRate ?? 0) : 0,
    trust: { grade: modelTrust as 'green' | 'yellow' | 'red', reasonsRu: [trustReason] },
  })

  const fxEvents = worldMapSnapshot
    ? buildWorldFxEvents({ current: currentFrame, previous: previousFrame, snapshot: worldMapSnapshot })
    : []

  const handleNextAction = () => {
    if (frames.length === 0 || !bestAction) {
      setLastActionReason('Нужны исходные данные, чтобы автопилот дал надёжный шаг.')
      navigate('/core')
      return
    }
    setLastActionReason(whyTopRu[0] ?? `Лучший ход по горизонту H7: ${bestAction.titleRu}.`)
    const firstPlanet = worldMapSnapshot?.planets[0]?.id
    if (firstPlanet) setHashPlanetId(firstPlanet)
  }

  return (
    <section className="world-page" aria-label="Кокпит мира">
      <div className="world-stage">
        {worldMapSnapshot ? (
          <WorldMapView
            snapshot={worldMapSnapshot}
            selectedPlanetId={selectedPlanetId}
            showNeighborLabels={false}
            fxEvents={fxEvents}
            onPlanetSelect={(planetId, origin) => {
              if (origin) lastOriginRef.current = origin
              setHashPlanetId(planetId)
            }}
          />
        ) : <p>Карта мира готовится…</p>}
        {selectedPlanet ? (
          <PlanetPanel
            planet={selectedPlanet}
            levers={panelLevers}
            whyBullets={whyTopRu}
            debtProtocol={debtProtocol}
            onClose={() => setHashPlanetId(null)}
            onApplyLever={(lever) => setLastActionReason(`Запланировано: ${lever.titleRu}. Проверьте результат в аудите.`)}
          />
        ) : null}
      </div>

      <aside className="world-action-rail panel" aria-label="Action rail">
        <div className="world-hud-grid" role="list" aria-label="Сигналы cockpit">
          {hudSignals.map((signal) => (
            <span key={signal.key} role="listitem"><strong>{signal.label}</strong> {signal.value}</span>
          ))}
        </div>
        <div className="world-action-rail__primary">
          <strong>Следующий шаг</strong>
          <button type="button" className="start-primary" onClick={handleNextAction}>
            {frames.length === 0 || !bestAction ? 'First check-in' : `Next Action: ${bestAction.titleRu}`}
          </button>
          <p className="mono">Почему: {lastActionReason}</p>
        </div>
        <details className="world-action-rail__details">
          <summary>Подробнее</summary>
          <ul>
            {topActions.map((action) => (
              <li key={action.id}><strong>{action.titleRu}</strong> · failRate {(action.failRate * 100).toFixed(1)}%</li>
            ))}
          </ul>
        </details>
      </aside>
    </section>
  )
}
