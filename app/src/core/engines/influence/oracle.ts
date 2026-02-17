import { METRICS, type MetricId } from '../../metrics'
import { applyImpulse, explainDriverInsights } from './influence'
import type { InfluenceMatrix, MetricVector } from './types'

export function propagateBySteps(
  base: MetricVector,
  impulses: Partial<Record<MetricId, number>>,
  matrix: InfluenceMatrix,
  maxSteps: 1 | 2 | 3,
): MetricVector[] {
  const vectors: MetricVector[] = []
  for (let step = 1; step <= maxSteps; step += 1) {
    vectors.push(applyImpulse(base, impulses, matrix, step))
  }
  return vectors
}

export function buildPlaybook(
  base: MetricVector,
  scenario: MetricVector,
  matrix: InfluenceMatrix,
): string[] {
  const insights = explainDriverInsights(scenario, base, matrix, 5)
  const actions: string[] = []

  for (const insight of insights) {
    const fromLabel = METRICS.find((m) => m.id === insight.from)?.labelRu ?? insight.from
    const toLabel = METRICS.find((m) => m.id === insight.to)?.labelRu ?? insight.to

    if (insight.weight > 0 && insight.change > 0) {
      actions.push(`Закрепите рост «${fromLabel}»: это дополнительно усиливает «${toLabel}».`)
    } else if (insight.weight < 0 && insight.change > 0) {
      actions.push(`Поставьте контроль для «${toLabel}»: рост «${fromLabel}» может его ослабить.`)
    } else if (insight.weight < 0 && insight.change < 0) {
      actions.push(`Снизьте давление в «${fromLabel}»: это поможет восстановить «${toLabel}».`)
    } else {
      actions.push(`Поддержите «${fromLabel}» через короткий ритуал, чтобы стабилизировать «${toLabel}».`)
    }
  }

  if (actions.length < 3) {
    actions.push('Зафиксируйте сценарий и проверьте динамику через 24 часа.')
  }

  return Array.from(new Set(actions)).slice(0, 3)
}
