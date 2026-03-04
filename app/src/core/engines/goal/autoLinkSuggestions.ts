import { dayKeyFromTs } from '../../utils/dayKey'
import type { GoalMissionHistoryItem, GoalRecord } from '../../models/goal'

export const AUTO_LINK_MIN_POINTS = 10
export const AUTO_LINK_MIN_ABS_R = 0.45

export interface AutoLinkSeriesPoint {
  day: string
  coresDelta: number
}

export interface AutoLinkSuggestion {
  sourceGoalId: string
  targetGoalId: string
  r: number
  sampleSize: number
  confidence: 'низк' | 'сред' | 'выс'
}

function aggregateCoresDelta(history: GoalMissionHistoryItem[]): AutoLinkSeriesPoint[] {
  const byDay = new Map<string, number>()
  for (const item of history) {
    const day = dayKeyFromTs(item.completedAt)
    byDay.set(day, (byDay.get(day) ?? 0) + item.coresAwarded)
  }
  return [...byDay.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([day, coresDelta]) => ({ day, coresDelta }))
}

function hasMinimumPoints(history: GoalMissionHistoryItem[], series: AutoLinkSeriesPoint[]): boolean {
  return history.length >= AUTO_LINK_MIN_POINTS || series.length >= AUTO_LINK_MIN_POINTS
}

function pearsonCorrelation(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length < AUTO_LINK_MIN_POINTS) return 0
  const leftMean = left.reduce((acc, value) => acc + value, 0) / left.length
  const rightMean = right.reduce((acc, value) => acc + value, 0) / right.length

  let numerator = 0
  let leftSq = 0
  let rightSq = 0

  for (let index = 0; index < left.length; index += 1) {
    const leftDiff = left[index] - leftMean
    const rightDiff = right[index] - rightMean
    numerator += leftDiff * rightDiff
    leftSq += leftDiff ** 2
    rightSq += rightDiff ** 2
  }

  if (!leftSq || !rightSq) return 0
  return numerator / Math.sqrt(leftSq * rightSq)
}

function confidenceFromCorrelation(r: number): AutoLinkSuggestion['confidence'] {
  const absR = Math.abs(r)
  if (absR >= 0.75) return 'выс'
  if (absR >= 0.6) return 'сред'
  return 'низк'
}

export function buildGoalAutoLinkSuggestions(source: GoalRecord, goals: GoalRecord[]): AutoLinkSuggestion[] {
  const sourceHistory = source.missionHistory ?? []
  const sourceSeries = aggregateCoresDelta(sourceHistory)
  if (!hasMinimumPoints(sourceHistory, sourceSeries)) return []

  const sourceByDay = new Map(sourceSeries.map((point) => [point.day, point.coresDelta]))
  const existingLinkedGoalIds = new Set((source.links ?? []).map((item) => item.toGoalId))

  return goals
    .filter((goal) => goal.id !== source.id)
    .filter((goal) => goal.status !== 'trashed')
    .filter((goal) => !existingLinkedGoalIds.has(goal.id))
    .map((targetGoal) => {
      const targetHistory = targetGoal.missionHistory ?? []
      const targetSeries = aggregateCoresDelta(targetHistory)
      if (!hasMinimumPoints(targetHistory, targetSeries)) return null

      const alignedDays = [...new Set([...sourceSeries.map((point) => point.day), ...targetSeries.map((point) => point.day)])]
        .sort((left, right) => left.localeCompare(right))
      if (alignedDays.length < AUTO_LINK_MIN_POINTS) return null

      const sourceAligned = alignedDays.map((day) => sourceByDay.get(day) ?? 0)
      const targetByDay = new Map(targetSeries.map((point) => [point.day, point.coresDelta]))
      const targetAligned = alignedDays.map((day) => targetByDay.get(day) ?? 0)
      const r = pearsonCorrelation(sourceAligned, targetAligned)
      if (Math.abs(r) < AUTO_LINK_MIN_ABS_R) return null

      return {
        sourceGoalId: source.id,
        targetGoalId: targetGoal.id,
        r,
        sampleSize: alignedDays.length,
        confidence: confidenceFromCorrelation(r),
      } satisfies AutoLinkSuggestion
    })
    .filter((item): item is AutoLinkSuggestion => Boolean(item))
    .sort((left, right) => Math.abs(right.r) - Math.abs(left.r))
}
