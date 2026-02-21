export interface PanZoomState {
  scale: number
  translateX: number
  translateY: number
  minScale: number
  maxScale: number
}

export interface Point {
  x: number
  y: number
}

export interface PanZoomBounds {
  minScale: number
  maxScale: number
}

export function createPanZoomState(bounds: PanZoomBounds = { minScale: 0.6, maxScale: 4 }): PanZoomState {
  return {
    scale: 1,
    translateX: 0,
    translateY: 0,
    minScale: bounds.minScale,
    maxScale: bounds.maxScale,
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function panBy(state: PanZoomState, delta: Point): PanZoomState {
  return {
    ...state,
    translateX: Number((state.translateX + delta.x).toFixed(3)),
    translateY: Number((state.translateY + delta.y).toFixed(3)),
  }
}

export function zoomAroundPoint(state: PanZoomState, scaleFactor: number, pivot: Point): PanZoomState {
  const nextScale = clamp(Number((state.scale * scaleFactor).toFixed(4)), state.minScale, state.maxScale)
  if (nextScale === state.scale) return state

  const worldX = (pivot.x - state.translateX) / state.scale
  const worldY = (pivot.y - state.translateY) / state.scale

  return {
    ...state,
    scale: nextScale,
    translateX: Number((pivot.x - worldX * nextScale).toFixed(3)),
    translateY: Number((pivot.y - worldY * nextScale).toFixed(3)),
  }
}

export function pinchTransform(
  stateAtPinchStart: PanZoomState,
  startDistance: number,
  currentDistance: number,
  startCenter: Point,
  currentCenter: Point,
): PanZoomState {
  const safeDistance = Math.max(1, startDistance)
  const scaleFactor = currentDistance / safeDistance
  const zoomed = zoomAroundPoint(stateAtPinchStart, scaleFactor, startCenter)
  return panBy(zoomed, { x: currentCenter.x - startCenter.x, y: currentCenter.y - startCenter.y })
}
