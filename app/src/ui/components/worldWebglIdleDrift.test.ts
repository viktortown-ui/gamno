import { describe, expect, it } from 'vitest'

import { IdleDriftController } from './worldWebglIdleDrift'

describe('IdleDriftController', () => {
  it('activates after idle timeout and pauses on user action', () => {
    const controller = new IdleDriftController({ reduceMotion: false, idleTimeoutMs: 60_000 }, 0)

    expect(controller.isEnabled(59_999)).toBe(false)
    expect(controller.isEnabled(60_000)).toBe(true)

    controller.notifyUserAction(61_000)
    expect(controller.isEnabled(120_000)).toBe(false)
    expect(controller.isEnabled(121_000)).toBe(true)
  })

  it('stays disabled when a planet is selected or panel interaction is active', () => {
    const controller = new IdleDriftController({ reduceMotion: false, idleTimeoutMs: 1_000 }, 0)

    controller.setSelectedId('planet:1', 900)
    expect(controller.isEnabled(5_000)).toBe(false)

    controller.setSelectedId(null, 5_000)
    controller.setPanelInteracting(true, 5_100)
    expect(controller.isEnabled(10_000)).toBe(false)

    controller.setPanelInteracting(false, 10_000)
    expect(controller.isEnabled(11_001)).toBe(true)
  })


  it('can still reach idle without explicit start events', () => {
    const controller = new IdleDriftController({ reduceMotion: false, idleTimeoutMs: 1_000 }, 0)
    expect(controller.isEnabled(1_001)).toBe(true)
  })
  it('is permanently disabled when reduce motion is on', () => {
    const controller = new IdleDriftController({ reduceMotion: true, idleTimeoutMs: 10 }, 0)
    expect(controller.isEnabled(1_000_000)).toBe(false)
  })



  it('ignores controls change events but treats controls start as user action', () => {
    const controller = new IdleDriftController({ reduceMotion: false, idleTimeoutMs: 1_000 }, 0)

    expect(controller.isEnabled(1_001)).toBe(true)
    controller.notifyControlsChange()
    expect(controller.isEnabled(1_001)).toBe(true)

    controller.notifyControlsStart(1_100)
    expect(controller.isEnabled(1_500)).toBe(false)
    expect(controller.isEnabled(2_101)).toBe(true)
  })

  it('is disabled when idle timeout is set to zero', () => {
    const controller = new IdleDriftController({ reduceMotion: false, idleTimeoutMs: 0 }, 0)
    expect(controller.isEnabled(1_000_000)).toBe(false)
  })
})
