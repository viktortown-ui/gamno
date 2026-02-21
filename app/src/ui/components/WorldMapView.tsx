import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { KeyboardEvent, PointerEvent as ReactPointerEvent, WheelEvent } from 'react'
import type { WorldMapPlanet, WorldMapSnapshot } from '../../core/worldMap/types'
import { createPanZoomState, panBy, pinchTransform, zoomAroundPoint, type PanZoomState } from './worldMapPanZoom'

interface WorldFxEvent {
  key: string
  type: 'pulse' | 'burst' | 'storm' | 'safe'
  planetId?: string
  intensity: number
}

interface WorldMapViewProps {
  snapshot: WorldMapSnapshot
  onPlanetSelect?: (planetId: string | null, origin?: HTMLElement | null) => void
  selectedPlanetId?: string | null
  showNeighborLabels?: boolean
  fxEvents?: WorldFxEvent[]
  uiVariant?: 'instrument' | 'cinematic'
}

interface PointerData {
  x: number
  y: number
}

interface PinchSession {
  pointerA: number
  pointerB: number
  startDistance: number
  startCenter: { x: number; y: number }
  baseState: PanZoomState
}

function distance(a: PointerData, b: PointerData): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function center(a: PointerData, b: PointerData): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

function dustField(snapshot: WorldMapSnapshot): Array<{ key: string; x: number; y: number; r: number; alpha: number }> {
  const dots = Math.max(24, Math.floor((snapshot.viewport.width * snapshot.viewport.height) / 45000))
  return Array.from({ length: dots }, (_, index) => {
    const seed = index + 1
    const x = Number((((Math.sin(seed * 12.9898) + 1) / 2) * snapshot.viewport.width).toFixed(2))
    const y = Number((((Math.sin(seed * 78.233) + 1) / 2) * snapshot.viewport.height).toFixed(2))
    return { key: `dust:${index}`, x, y, r: 0.6 + ((index % 4) * 0.3), alpha: 0.12 + ((index % 5) * 0.03) }
  })
}

export function WorldMapView({ snapshot, onPlanetSelect, selectedPlanetId, showNeighborLabels = true, fxEvents = [], uiVariant = 'instrument' }: WorldMapViewProps) {
  const planets = useMemo(() => [...snapshot.planets].sort((a, b) => (a.order - b.order) || a.id.localeCompare(b.id, 'ru')), [snapshot.planets])
  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(null)
  const [focusedId, setFocusedId] = useState<string>(planets[0]?.id ?? '')
  const [transform, setTransform] = useState<PanZoomState>(() => createPanZoomState())
  const [isPanning, setIsPanning] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)

  const pointerMapRef = useRef<Map<number, PointerData>>(new Map())
  const lastPanPointRef = useRef<PointerData | null>(null)
  const pinchSessionRef = useRef<PinchSession | null>(null)
  const focusRefs = useRef<Map<string, HTMLButtonElement>>(new Map())

  useEffect(() => {
    const active = focusRefs.current.get(focusedId)
    if (active && document.activeElement !== active) active.focus()
  }, [focusedId])

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => setReducedMotion(media.matches)
    apply()
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', apply)
      return () => media.removeEventListener('change', apply)
    }
    media.addListener?.(apply)
    return () => media.removeListener?.(apply)
  }, [])

  const fxByPlanet = useMemo(() => {
    const map = new Map<string, WorldFxEvent[]>()
    if (reducedMotion) return map
    fxEvents.forEach((event) => {
      if (!event.planetId) return
      const row = map.get(event.planetId) ?? []
      row.push(event)
      map.set(event.planetId, row)
    })
    return map
  }, [fxEvents, reducedMotion])

  const stormIntensity = useMemo(() => {
    if (reducedMotion) return 0
    const baseRisk = Math.min(1, Math.max(snapshot.metrics.risk, snapshot.metrics.esCollapse10, snapshot.metrics.failProbability))
    const fxStorm = fxEvents.filter((item) => item.type === 'storm').reduce((max, item) => Math.max(max, item.intensity), 0)
    const sirenBoost = snapshot.metrics.sirenLevel === 'red' ? 0.35 : snapshot.metrics.sirenLevel === 'amber' ? 0.2 : 0.08
    return Math.min(1, baseRisk * 0.6 + fxStorm * 0.5 + sirenBoost)
  }, [fxEvents, reducedMotion, snapshot.metrics])

  const safeModeIntensity = useMemo(() => {
    if (reducedMotion) return 0
    const fxSafe = fxEvents.filter((item) => item.type === 'safe').reduce((max, item) => Math.max(max, item.intensity), 0)
    return snapshot.metrics.safeMode ? Math.max(0.48, fxSafe) : fxSafe
  }, [fxEvents, reducedMotion, snapshot.metrics.safeMode])

  const selectedId = selectedPlanetId ?? internalSelectedId
  const visibleLabelIds = useMemo(() => {
    if (!selectedId) return new Set<string>()
    const selectedIndex = planets.findIndex((planet) => planet.id === selectedId)
    if (selectedIndex < 0) return new Set<string>()
    const ids = new Set<string>([selectedId])
    if (showNeighborLabels) {
      const prev = planets[(selectedIndex - 1 + planets.length) % planets.length]
      const next = planets[(selectedIndex + 1) % planets.length]
      if (prev) ids.add(prev.id)
      if (next) ids.add(next.id)
    }
    return ids
  }, [planets, selectedId, showNeighborLabels])

  const dust = useMemo(() => (reducedMotion ? [] : dustField(snapshot)), [reducedMotion, snapshot])

  const selectPlanet = (id: string | null, origin?: HTMLElement | null) => {
    setInternalSelectedId(id)
    onPlanetSelect?.(id, origin)
  }

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    const point = { x: event.clientX, y: event.clientY }
    pointerMapRef.current.set(event.pointerId, point)

    if (pointerMapRef.current.size === 1) {
      lastPanPointRef.current = point
      setIsPanning(true)
      pinchSessionRef.current = null
      return
    }

    if (pointerMapRef.current.size === 2) {
      const entries = [...pointerMapRef.current.entries()]
      const [firstId, firstPoint] = entries[0]
      const [secondId, secondPoint] = entries[1]
      pinchSessionRef.current = {
        pointerA: firstId,
        pointerB: secondId,
        startDistance: distance(firstPoint, secondPoint),
        startCenter: center(firstPoint, secondPoint),
        baseState: transform,
      }
      setIsPanning(false)
    }
  }

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const currentPoint = { x: event.clientX, y: event.clientY }
    if (!pointerMapRef.current.has(event.pointerId)) return
    pointerMapRef.current.set(event.pointerId, currentPoint)

    const pinch = pinchSessionRef.current
    if (pinch) {
      const pointA = pointerMapRef.current.get(pinch.pointerA)
      const pointB = pointerMapRef.current.get(pinch.pointerB)
      if (!pointA || !pointB) return
      const currentCenter = center(pointA, pointB)
      const next = pinchTransform(pinch.baseState, pinch.startDistance, distance(pointA, pointB), pinch.startCenter, currentCenter)
      setTransform(next)
      return
    }

    if (!isPanning || !lastPanPointRef.current) return
    const delta = {
      x: currentPoint.x - lastPanPointRef.current.x,
      y: currentPoint.y - lastPanPointRef.current.y,
    }
    lastPanPointRef.current = currentPoint
    setTransform((prev) => panBy(prev, delta))
  }

  const handlePointerEnd = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    pointerMapRef.current.delete(event.pointerId)
    if (pointerMapRef.current.size < 2) pinchSessionRef.current = null
    if (pointerMapRef.current.size === 0) {
      setIsPanning(false)
      lastPanPointRef.current = null
    }
  }

  const handleWheel = (event: WheelEvent<SVGSVGElement>) => {
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    const pivot = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    const factor = event.deltaY < 0 ? 1.08 : 0.92
    setTransform((prev) => zoomAroundPoint(prev, factor, pivot))
  }

  const moveFocus = (direction: -1 | 1) => {
    const currentIndex = planets.findIndex((planet) => planet.id === focusedId)
    if (currentIndex < 0) return
    const nextIndex = (currentIndex + direction + planets.length) % planets.length
    const nextId = planets[nextIndex]?.id
    if (!nextId) return
    setFocusedId(nextId)
  }

  const handlePlanetKey = (event: KeyboardEvent<HTMLButtonElement>, planet: WorldMapPlanet) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault()
      moveFocus(1)
      return
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault()
      moveFocus(-1)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      selectPlanet(planet.id, event.currentTarget)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      selectPlanet(null)
    }
  }

  return (
    <div
      data-ui-variant={uiVariant}
      className={`world-map world-map--${uiVariant} ${stormIntensity > 0 ? 'world-map--storm' : ''} ${safeModeIntensity > 0 ? 'world-map--safe' : ''} ${reducedMotion ? 'world-map--reduced-motion' : ''}`.trim()}
      style={{ '--storm-alpha': String(Math.min(0.56, 0.08 + stormIntensity * 0.38)), '--safe-alpha': String(Math.min(0.42, 0.08 + safeModeIntensity * 0.3)) } as CSSProperties}
      role="region"
      aria-label="Карта мира"
    >
      <svg
        viewBox={`0 0 ${snapshot.viewport.width} ${snapshot.viewport.height}`}
        className="world-map__svg"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onWheel={handleWheel}
      >
        <defs>
          <radialGradient id="planet-shade" cx="30%" cy="28%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.85)" />
            <stop offset="42%" stopColor="rgba(130,174,255,0.86)" />
            <stop offset="100%" stopColor="rgba(32,52,102,0.95)" />
          </radialGradient>
        </defs>
        <g transform={`translate(${transform.translateX} ${transform.translateY}) scale(${transform.scale})`}>
          {snapshot.rings.map((ring) => (
            <circle
              key={ring.id}
              id={`svg-${ring.id}`}
              cx={snapshot.center.x}
              cy={snapshot.center.y}
              r={ring.radius}
              fill="none"
              stroke={uiVariant === 'cinematic' ? 'rgba(143, 107, 255, 0.24)' : 'rgba(143, 107, 255, 0.36)'}
              strokeWidth={ring.width}
              aria-label={`Орбита ${ring.domainId}`}
            />
          ))}

          {dust.map((item) => (
            <circle key={item.key} cx={item.x} cy={item.y} r={item.r} fill={`rgba(205,225,255,${item.alpha})`} className="world-map__dust" />
          ))}

          {planets.map((planet) => {
            const selected = selectedId === planet.id
            const planetFx = fxByPlanet.get(planet.id) ?? []
            const pulse = planetFx.find((item) => item.type === 'pulse')
            const burst = planetFx.find((item) => item.type === 'burst')
            const emphasis = Math.min(1.15, Math.max(0.5, planet.importance + planet.metrics.risk * 0.45 + planet.metrics.budgetPressure * 0.3))
            return (
              <g key={planet.id} id={`svg-${planet.id}`}>
                <circle cx={planet.x} cy={planet.y} r={planet.radius + 5 + emphasis * 4} fill={planet.renderHints.drawTailGlow ? 'rgba(60, 255, 214, 0.16)' : 'rgba(111, 162, 255, 0.11)'} />
                {pulse ? <circle cx={planet.x} cy={planet.y} r={planet.radius + 10 + pulse.intensity * 8} fill="none" stroke="rgba(67, 243, 208, 0.7)" strokeWidth={1.5 + pulse.intensity * 1.5} className="world-map__pulse" /> : null}
                {burst ? <circle cx={planet.x} cy={planet.y} r={planet.radius + 4 + burst.intensity * 6} fill="rgba(125, 255, 186, 0.25)" className="world-map__pulse" /> : null}
                <circle
                  cx={planet.x}
                  cy={planet.y}
                  r={planet.radius + emphasis * 1.3}
                  fill="url(#planet-shade)"
                  stroke={planet.renderHints.hasStorm ? 'rgba(255, 154, 154, 0.9)' : 'rgba(240, 246, 255, 0.7)'}
                  strokeWidth={selected ? 2.4 : 1.3}
                  onClick={() => selectPlanet(planet.id)}
                  aria-labelledby={`label:${planet.id}`}
                />
                {selected ? <circle cx={planet.x} cy={planet.y} r={planet.radius + 10} fill="none" stroke="rgba(101, 252, 224, 0.9)" strokeWidth={2.2} className="world-map__pulse" /> : null}
                {visibleLabelIds.has(planet.id) ? <text id={`label:${planet.id}`} x={planet.x} y={planet.y - planet.radius - 10} textAnchor="middle" fontSize={11} fill="#f6fbff">{planet.labelRu}</text> : null}
              </g>
            )
          })}
        </g>
      </svg>

      <div className="world-map__focus-layer" role="listbox" aria-label="Планеты мира" aria-activedescendant={focusedId ? `option-${focusedId}` : undefined}>
        {planets.map((planet) => {
          const focused = focusedId === planet.id
          return (
            <button
              key={`focus:${planet.id}`}
              id={`option-${planet.id}`}
              type="button"
              role="option"
              aria-selected={selectedId === planet.id}
              data-planet-id={planet.id}
              className="world-map__focus-point"
              style={{ left: `${planet.x}px`, top: `${planet.y}px`, width: `${planet.radius * 2}px`, height: `${planet.radius * 2}px` }}
              tabIndex={focused ? 0 : -1}
              ref={(element) => {
                if (element) focusRefs.current.set(planet.id, element)
                else focusRefs.current.delete(planet.id)
              }}
              onFocus={() => setFocusedId(planet.id)}
              onKeyDown={(event) => handlePlanetKey(event, planet)}
              onClick={(event) => selectPlanet(planet.id, event.currentTarget)}
            >
              <span className="world-map__sr">{planet.labelRu}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
