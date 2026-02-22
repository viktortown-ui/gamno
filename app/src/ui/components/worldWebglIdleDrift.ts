export interface IdleDriftControllerOptions {
  idleTimeoutMs?: number
  reduceMotion: boolean
}

export interface IdleDriftState {
  enabled: boolean
  selectedId: string | null
  panelInteracting: boolean
}

export class IdleDriftController {
  private readonly idleMs: number

  private readonly reduceMotion: boolean

  private lastActionMs: number

  private selectedId: string | null = null

  private panelInteracting = false

  constructor(options: IdleDriftControllerOptions, nowMs: number) {
    this.idleMs = options.idleTimeoutMs ?? 60_000
    this.reduceMotion = options.reduceMotion
    this.lastActionMs = nowMs
  }

  notifyUserAction(nowMs: number): void {
    this.lastActionMs = nowMs
  }

  notifyControlsStart(nowMs: number): void {
    this.notifyUserAction(nowMs)
  }

  notifyControlsChange(): void {
    // OrbitControls change can fire continuously with damping.
  }


  setSelectedId(selectedId: string | null, nowMs: number): void {
    this.selectedId = selectedId
    if (selectedId) {
      this.lastActionMs = nowMs
    }
  }

  setPanelInteracting(panelInteracting: boolean, nowMs: number): void {
    this.panelInteracting = panelInteracting
    if (panelInteracting) {
      this.lastActionMs = nowMs
    }
  }

  isEnabled(nowMs: number): boolean {
    if (this.reduceMotion) return false
    if (this.idleMs <= 0) return false
    if (this.selectedId) return false
    if (this.panelInteracting) return false
    return nowMs - this.lastActionMs >= this.idleMs
  }

  getState(nowMs: number): IdleDriftState {
    return {
      enabled: this.isEnabled(nowMs),
      selectedId: this.selectedId,
      panelInteracting: this.panelInteracting,
    }
  }
}
