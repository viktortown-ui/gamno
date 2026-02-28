import { METRICS } from '../../../core/metrics'
import type { GoalKeyResult } from '../../../core/models/goal'

interface AdvancedTuningProps {
  keyResults: GoalKeyResult[]
  showDebugNumbers: boolean
  onToggleDebugNumbers: (value: boolean) => void
  onUpdateKr: (krId: string, patch: Partial<GoalKeyResult>) => void
}

export function AdvancedTuning({ keyResults, showDebugNumbers, onToggleDebugNumbers, onUpdateKr }: AdvancedTuningProps) {
  return (
    <section className="forge-advanced">
      <h3>KR-направления</h3>
      {keyResults.map((kr, index) => (
        <div key={kr.id} className="forge-advanced__kr">
          <strong>KR{index + 1}: {METRICS.find((item) => item.id === kr.metricId)?.labelRu ?? kr.metricId}</strong>
          <label>
            Направление
            <select value={kr.direction} onChange={(event) => onUpdateKr(kr.id, { direction: event.target.value as 'up' | 'down' })}>
              <option value="up">Вверх</option>
              <option value="down">Вниз</option>
            </select>
          </label>
          <label>
            Режим прогресса
            <select value={kr.progressMode ?? 'auto'} onChange={(event) => onUpdateKr(kr.id, { progressMode: event.target.value as 'auto' | 'manual' })}>
              <option value="auto">Авто</option>
              <option value="manual">Ручной</option>
            </select>
          </label>
          {showDebugNumbers ? (
            <>
              <label>
                Цель (debug)
                <input type="number" value={kr.target ?? ''} onChange={(event) => onUpdateKr(kr.id, { target: event.target.value ? Number(event.target.value) : undefined })} />
              </label>
              {(kr.progressMode ?? 'auto') === 'manual' ? (
                <label>
                  Progress (0..1) debug
                  <input type="range" min={0} max={1} step={0.1} value={kr.progress ?? 0} onChange={(event) => onUpdateKr(kr.id, { progress: Number(event.target.value) })} />
                </label>
              ) : null}
            </>
          ) : null}
        </div>
      ))}
      <label className="goals-debug-toggle">
        <input type="checkbox" checked={showDebugNumbers} onChange={(event) => onToggleDebugNumbers(event.target.checked)} />
        Показать числа (debug)
      </label>
    </section>
  )
}
