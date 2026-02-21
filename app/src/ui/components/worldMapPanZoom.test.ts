import { describe, expect, it } from 'vitest'
import { createPanZoomState, panBy, pinchTransform, zoomAroundPoint } from './worldMapPanZoom'

describe('worldMapPanZoom', () => {
  it('applies deterministic pan delta', () => {
    const state = createPanZoomState()
    const next = panBy(state, { x: 15.1256, y: -8.6688 })

    expect(next).toEqual({ ...state, translateX: 15.126, translateY: -8.669 })
  })

  it('zooms around pointer while preserving world position under pivot', () => {
    const state = { ...createPanZoomState(), scale: 1.2, translateX: 40, translateY: 24 }
    const next = zoomAroundPoint(state, 1.1, { x: 300, y: 180 })

    expect(next.scale).toBe(1.32)
    expect(next.translateX).toBe(14)
    expect(next.translateY).toBe(8.4)
  })

  it('applies pinch zoom and pan from fixed start state', () => {
    const state = { ...createPanZoomState(), scale: 1.1, translateX: 12, translateY: -6 }
    const next = pinchTransform(state, 100, 150, { x: 200, y: 200 }, { x: 230, y: 220 })

    expect(next).toEqual({
      ...state,
      scale: 1.65,
      translateX: -52,
      translateY: -89,
    })
  })
})
