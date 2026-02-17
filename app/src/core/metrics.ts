import type { CheckinValues } from './models/checkin'

export type MetricId = keyof CheckinValues

export interface MetricConfig {
  id: MetricId
  labelRu: string
  min: number
  max: number
  step: number
  unitRu?: string
  defaultValue: number
  sliderEnabled?: boolean
}

export const METRICS: MetricConfig[] = [
  { id: 'energy', labelRu: 'Энергия', min: 0, max: 10, step: 1, defaultValue: 5 },
  { id: 'focus', labelRu: 'Фокус', min: 0, max: 10, step: 1, defaultValue: 5 },
  { id: 'mood', labelRu: 'Настроение', min: 0, max: 10, step: 1, defaultValue: 5 },
  { id: 'stress', labelRu: 'Стресс', min: 0, max: 10, step: 1, defaultValue: 5 },
  { id: 'sleepHours', labelRu: 'Сон', min: 0, max: 12, step: 0.5, unitRu: 'ч', defaultValue: 8 },
  { id: 'social', labelRu: 'Социальность', min: 0, max: 10, step: 1, defaultValue: 5 },
  {
    id: 'productivity',
    labelRu: 'Продуктивность',
    min: 0,
    max: 10,
    step: 1,
    defaultValue: 5,
  },
  { id: 'health', labelRu: 'Самочувствие', min: 0, max: 10, step: 1, defaultValue: 5 },
  {
    id: 'cashFlow',
    labelRu: 'Денежный поток',
    min: -1000000,
    max: 1000000,
    step: 100,
    unitRu: '₽',
    defaultValue: 0,
    sliderEnabled: false,
  },
]

export const DEFAULT_CHECKIN_VALUES: CheckinValues = METRICS.reduce(
  (acc, metric) => ({ ...acc, [metric.id]: metric.defaultValue }),
  {} as CheckinValues,
)

export const INDEX_METRIC_IDS: MetricId[] = METRICS.filter((metric) => metric.id !== 'cashFlow').map(
  (metric) => metric.id,
)
