import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent as ReactPointerEvent, WheelEvent } from 'react'
import type { WorldMapPlanet, WorldMapSnapshot } from '../../core/worldMap/types'
import { createPanZoomState, panBy, pinchTransform, zoomAroundPoint, type PanZoomState } from './worldMapPanZoom'

interface WorldFxEvent {
  key: string
  type: 'pulse' | 'burst' | 'storm'
  planetId?: string
  intensity: number
}

interface WorldMapViewProps {
  snapshot: WorldMapSnapshot
  onPlanetSelect?: (planetId: string | null, origin?: HTMLElement | null) => void
  selectedPlanetId?: string | null
  showNeighborLabels?: boolean
  fxEvents?: WorldFxEvent[]
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

export function WorldMapView({ snapshot, onPlanetSelect, selectedPlanetId, showNeighborLabels = true, fxEvents = [] }: WorldMapViewProps) {
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
    return fxEvents
      .filter((item) => item.type === 'storm')
      .reduce((max, item) => Math.max(max, item.intensity), 0)
  }, [fxEvents, reducedMotion])

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
    <div className="world-map" role="region" aria-label="Карта мира">
      <svg
        viewBox={`0 0 ${snapshot.viewport.width} ${snapshot.viewport.height}`}
        className="world-map__svg"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onWheel={handleWheel}
      >
        <g transform={`translate(${transform.translateX} ${transform.translateY}) scale(${transform.scale})`}>
          {snapshot.rings.map((ring) => (
            <circle
              key={ring.id}
              id={`svg-${ring.id}`}
              cx={snapshot.center.x}
              cy={snapshot.center.y}
              r={ring.radius}
              fill="none"
              stroke="rgba(143, 107, 255, 0.4)"
              strokeWidth={ring.width}
              aria-label={`Орбита ${ring.domainId}`}
            />
          ))}

          {stormIntensity > 0 ? <rect x={0} y={0} width={snapshot.viewport.width} height={snapshot.viewport.height} fill={`rgba(255,90,90,${Math.min(0.22, 0.08 + stormIntensity * 0.18)})`} /> : null}

          {snapshot.domains.map((domain) => (
            <text key={`label:${domain.id}`} x={snapshot.center.x + domain.orbitRadius + 12} y={snapshot.center.y} fill="var(--muted)" fontSize={11}>{domain.labelRu}</text>
          ))}

          {planets.map((planet) => {
            const selected = selectedId === planet.id
            const planetFx = fxByPlanet.get(planet.id) ?? []
            const pulse = planetFx.find((item) => item.type === 'pulse')
            const burst = planetFx.find((item) => item.type === 'burst')
            const burstParticles = burst
              ? Array.from({ length: 6 }, (_, index) => {
                const angle = (Math.PI * 2 * index) / 6
                const distance = planet.radius + 8 + burst.intensity * 10
                return {
                  key: `${planet.id}:spark:${index}`,
                  x: planet.x + Math.cos(angle) * distance,
                  y: planet.y + Math.sin(angle) * distance,
                  r: Math.max(1.4, 2.6 - burst.intensity),
                }
              })
              : []
            return (
              <g key={planet.id} id={`svg-${planet.id}`}>
                {planet.renderHints.drawTailGlow ? (
                  <circle cx={planet.x} cy={planet.y} r={planet.radius + 8} fill="rgba(46, 233, 210, 0.1)" />
                ) : null}
                {pulse ? <circle cx={planet.x} cy={planet.y} r={planet.radius + 10 + pulse.intensity * 8} fill="none" stroke="rgba(67, 243, 208, 0.7)" strokeWidth={1.5 + pulse.intensity * 1.5} /> : null}
                {burst ? <circle cx={planet.x} cy={planet.y} r={planet.radius + 4 + burst.intensity * 6} fill="rgba(125, 255, 186, 0.25)" /> : null}
                {burstParticles.map((spark) => (
                  <circle key={spark.key} cx={spark.x} cy={spark.y} r={spark.r} fill="rgba(155, 255, 203, 0.7)" />
                ))}
                <circle
                  cx={planet.x}
                  cy={planet.y}
                  r={planet.radius}
                  fill={selected ? 'rgba(67, 243, 208, 0.68)' : 'rgba(95, 138, 255, 0.7)'}
                  stroke={planet.renderHints.hasStorm ? 'rgba(255, 132, 132, 0.9)' : 'rgba(234, 241, 255, 0.8)'}
                  strokeWidth={selected ? 3 : 1.5}
                  onClick={() => selectPlanet(planet.id)}
                  aria-labelledby={`label:${planet.id}`}
                />
                {visibleLabelIds.has(planet.id) ? <text id={`label:${planet.id}`} x={planet.x} y={planet.y + 4} textAnchor="middle" fontSize={10} fill="#fff">{planet.labelRu}</text> : null}
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
