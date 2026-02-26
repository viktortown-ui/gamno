import { METRICS, type MetricId } from '../../core/metrics'
import type { GoalRecord } from '../../core/models/goal'
import type { suggestGoalActions } from '../../core/engines/goal'

type GoalAction = ReturnType<typeof suggestGoalActions>[number]
type TreeWeather = 'storm' | 'grow' | 'dry'

interface Props {
  goal: GoalRecord
  actions: GoalAction[]
  weather: TreeWeather
}

const metricName = new Map(METRICS.map((metric) => [metric.id, metric.labelRu]))

export function GoalYggdrasilTree({ goal, actions, weather }: Props) {
  const weatherLabel = weather === 'grow' ? 'Растёт' : weather === 'storm' ? 'Штормит' : 'Сохнет'
  const keyResults = goal.okr.keyResults.length > 0
    ? goal.okr.keyResults
    : Object.entries(goal.weights)
      .slice(0, 3)
      .map(([metricId]) => ({ id: metricId, metricId: metricId as MetricId }))

  return (
    <div className="goal-yggdrasil">
      <div className="goal-yggdrasil__head">
        <h3>Иггдрасиль строится…</h3>
      </div>
      <div className="goal-yggdrasil__details panel">
        <p>Визуализация дерева появится в следующем PR. Сейчас доступен ясный верхний слой состояния и миссии.</p>
        <p><strong>Погода дерева:</strong> {weatherLabel}</p>
        <p><strong>Текущие ветви:</strong></p>
        <ul>
          {keyResults.map((kr, index) => (
            <li key={kr.id}>KR{index + 1}: {metricName.get(kr.metricId) ?? kr.metricId}</li>
          ))}
        </ul>
        {actions[0] ? <p><strong>Рекомендация:</strong> {actions[0].titleRu}</p> : null}
      </div>
    </div>
  )
}
