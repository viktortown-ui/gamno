import type { BlackSwanScenarioSpec } from './types'

export const BLACK_SWAN_PRESETS: BlackSwanScenarioSpec[] = [
  { nameRu: 'Провал сна на неделю', horizonDays: 14, sims: 2000, noise: 1.1, correlationTag: 'здоровье', shocks: [{ metricId: 'sleepHours', delta: -1.5, durationDays: 7, mode: 'daily' }] },
  { nameRu: 'Стресс растёт', horizonDays: 14, sims: 2000, noise: 1.2, correlationTag: 'здоровье', shocks: [{ metricId: 'stress', delta: 1.2, durationDays: 10, mode: 'daily' }] },
  { nameRu: 'Соц. конфликт', horizonDays: 7, sims: 2000, noise: 1.15, correlationTag: 'социум', shocks: [{ metricId: 'social', delta: -2, durationDays: 3, mode: 'step' }, { metricId: 'mood', delta: -1.2, durationDays: 5, mode: 'daily' }] },
  { nameRu: 'Падение продуктивности', horizonDays: 14, sims: 2000, noise: 1, correlationTag: 'работа', shocks: [{ metricId: 'productivity', delta: -1.8, durationDays: 7, mode: 'daily' }] },
  { nameRu: 'Финансовый разрыв', horizonDays: 30, sims: 2000, noise: 1.05, correlationTag: 'деньги', shocks: [{ metricId: 'cashFlow', delta: -12000, durationDays: 10, mode: 'daily' }, { metricId: 'stress', delta: 0.6, durationDays: 8, startLagDays: 1, mode: 'daily' }] },
  { nameRu: 'Комбо: сон↓ + стресс↑', horizonDays: 14, sims: 10000, noise: 1.3, correlationTag: 'комбо', shocks: [{ metricId: 'sleepHours', delta: -1.2, durationDays: 7, mode: 'daily' }, { metricId: 'stress', delta: 1, durationDays: 7, mode: 'daily' }] },
  { nameRu: 'Затяжная усталость', horizonDays: 30, sims: 2000, noise: 1.2, correlationTag: 'здоровье', shocks: [{ metricId: 'energy', delta: -0.7, durationDays: 18, mode: 'daily' }] },
  { nameRu: 'Дефицит фокуса', horizonDays: 7, sims: 2000, noise: 1.1, correlationTag: 'работа', shocks: [{ metricId: 'focus', delta: -1.5, durationDays: 5, mode: 'daily' }] },
  { nameRu: 'Изоляция', horizonDays: 14, sims: 2000, noise: 1, correlationTag: 'социум', shocks: [{ metricId: 'social', delta: -1.8, durationDays: 10, mode: 'daily' }] },
  { nameRu: 'Переутомление', horizonDays: 14, sims: 10000, noise: 1.35, correlationTag: 'работа', shocks: [{ metricId: 'sleepHours', delta: -1, durationDays: 8, mode: 'daily' }, { metricId: 'energy', delta: -0.8, durationDays: 8, mode: 'daily' }, { metricId: 'stress', delta: 0.9, durationDays: 8, mode: 'daily' }] },
]
