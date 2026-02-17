import { METRICS, type MetricConfig } from '../core/metrics'

export function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString('ru-RU')
}

export function formatNumber(value: number, digits = 1): string {
  return value.toFixed(digits).replace('.0', '')
}

export function formatMetricValue(metric: MetricConfig, value: number): string {
  const normalized = metric.step < 1 ? value.toFixed(1) : String(Math.round(value))
  if (metric.unitRu === '₽') {
    return `${new Intl.NumberFormat('ru-RU').format(Number(normalized))} ${metric.unitRu}`
  }
  return metric.unitRu ? `${normalized} ${metric.unitRu}` : normalized
}

export function getMetricConfig(metricId: MetricConfig['id']): MetricConfig {
  return METRICS.find((item) => item.id === metricId) ?? METRICS[0]
}
