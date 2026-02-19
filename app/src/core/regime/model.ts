import type { CheckinRecord } from '../models/checkin'
import type { RegimeDefinition, RegimeDistribution, RegimeId } from '../models/regime'

export interface DaySignals {
  dayIndex: number
  volatility: number
  stress: number
  sleepHours: number
  energy: number
  mood: number
  prevDayIndex?: number
}

export const REGIMES: RegimeDefinition[] = [
  { id: 0, labelRu: 'Стабилизация', descriptionRu: 'Ровный режим с восстановлением после нагрузки.' },
  { id: 1, labelRu: 'Разгон', descriptionRu: 'Позитивный импульс и уверенное улучшение.' },
  { id: 2, labelRu: 'Перегрев', descriptionRu: 'Высокая тяга вперёд с риском истощения.' },
  { id: 3, labelRu: 'Просадка', descriptionRu: 'Снижение ёмкости и дефицит ресурса.' },
  { id: 4, labelRu: 'Шторм', descriptionRu: 'Нестабильность и повышенный системный риск.' },
]

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function toLoad(stress: number, energy: number): number {
  return clamp((stress - energy + 10) * 5, 0, 100)
}

function toRecovery(sleepHours: number, energy: number, stress: number): number {
  return clamp((sleepHours + energy - stress + 2) * 8, 0, 100)
}

function toMomentum(dayIndex: number, prevDayIndex?: number): number {
  if (typeof prevDayIndex !== 'number') return 0
  return clamp(dayIndex - prevDayIndex, -3, 3)
}

export function regimeFromDay(signals: DaySignals): RegimeId {
  const load = toLoad(signals.stress, signals.energy)
  const recovery = toRecovery(signals.sleepHours, signals.energy, signals.stress)
  const momentum = toMomentum(signals.dayIndex, signals.prevDayIndex)

  if (signals.volatility >= 70 || (load >= 72 && signals.mood <= 3.5)) return 4
  if (load >= 68 && recovery <= 45) return 2
  if (signals.dayIndex <= 40 || recovery <= 30 || (signals.energy <= 3.5 && signals.mood <= 4.5)) return 3
  if (signals.dayIndex >= 60 && momentum >= 0.6 && recovery >= 54 && load <= 56) return 1
  return 0
}

export function explainRegime(signals: DaySignals, regimeId: RegimeId): string[] {
  const load = toLoad(signals.stress, signals.energy)
  const recovery = toRecovery(signals.sleepHours, signals.energy, signals.stress)
  const momentum = toMomentum(signals.dayIndex, signals.prevDayIndex)

  const reasonsByRegime: Record<RegimeId, string[]> = {
    0: [
      `Нагрузка умеренная (${load.toFixed(0)}/100), без критических перегибов.`,
      `Восстановление в коридоре устойчивости (${recovery.toFixed(0)}/100).`,
      `Импульс дня ровный (${momentum >= 0 ? '+' : ''}${momentum.toFixed(1)} к индексу).`,
    ],
    1: [
      `Индекс высокий (${signals.dayIndex.toFixed(1)}) и продолжает расти.`,
      `Положительный импульс (${momentum >= 0 ? '+' : ''}${momentum.toFixed(1)}).`,
      `Восстановление сильнее нагрузки (${recovery.toFixed(0)} против ${load.toFixed(0)}).`,
    ],
    2: [
      `Нагрузка повышена (${load.toFixed(0)}/100).`,
      `Восстановление не успевает (${recovery.toFixed(0)}/100).`,
      `Драйв остаётся высоким, но риск усталости растёт.`,
    ],
    3: [
      `Индекс дня в зоне снижения (${signals.dayIndex.toFixed(1)}).`,
      `Ресурс восстановления просел (${recovery.toFixed(0)}/100).`,
      `Энергия/настроение ограничивают темп восстановления.`,
    ],
    4: [
      `Волатильность критическая (${signals.volatility.toFixed(1)}).`,
      `Нагрузка резко выше ресурса (${load.toFixed(0)} при восстановлении ${recovery.toFixed(0)}).`,
      `Сочетание стресса и низкого настроения повышает риск срыва.`,
    ],
  }

  return reasonsByRegime[regimeId].slice(0, 3)
}

export function getTransitionMatrix(series: RegimeId[], addK = 0.5): number[][] {
  const size = REGIMES.length
  const counts = Array.from({ length: size }, () => Array.from({ length: size }, () => addK))

  for (let index = 0; index < series.length - 1; index += 1) {
    const from = series[index]
    const to = series[index + 1]
    counts[from][to] += 1
  }

  return counts.map((row) => {
    const total = row.reduce((sum, value) => sum + value, 0)
    return row.map((value) => value / total)
  })
}

function multiplyDistribution(vector: number[], matrix: number[][]): number[] {
  return matrix[0].map((_, to) => vector.reduce((sum, probability, from) => sum + probability * matrix[from][to], 0))
}

export function predictNext(regimeId: RegimeId, matrix: number[][], steps: 1 | 2 | 3 = 1): RegimeDistribution[] {
  let vector: number[] = REGIMES.map((item) => (item.id === regimeId ? 1 : 0))

  for (let step = 0; step < steps; step += 1) {
    vector = multiplyDistribution(vector, matrix)
  }

  return vector.map((probability, index) => ({ regimeId: index as RegimeId, probability }))
}

export function buildRegimeSeriesFromCheckins(checkinsAsc: CheckinRecord[], dayIndexes: number[], volatility: number): RegimeId[] {
  return checkinsAsc.map((checkin, index) => {
    const dayIndex = dayIndexes[index] ?? dayIndexes.at(-1) ?? 50
    const prevDayIndex = index > 0 ? dayIndexes[index - 1] : undefined
    return regimeFromDay({
      dayIndex,
      prevDayIndex,
      volatility,
      stress: checkin.stress,
      sleepHours: checkin.sleepHours,
      energy: checkin.energy,
      mood: checkin.mood,
    })
  })
}
