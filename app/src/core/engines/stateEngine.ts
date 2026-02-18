import type { CheckinRecord } from '../models/checkin'
import type { QuestRecord } from '../models/quest'
import { computeAverages, computeIndexSeries, computeVolatility } from './analytics/compute'
import { INDEX_METRIC_IDS } from '../metrics'

export interface CoreStats {
  strength: number
  intelligence: number
  wisdom: number
  dexterity: number
}

export interface CoreStateSnapshot {
  id?: number
  ts: number
  index: number
  risk: number
  volatility: number
  xp: number
  level: number
  stats: CoreStats
  entropy: number
  drift: number
}

export interface CoreContributor {
  id: string
  title: string
  text: string
  score: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function round1(value: number): number {
  return Number(value.toFixed(1))
}

function score10(value: number): number {
  return clamp(value / 10, 0, 1)
}

function scoreSleep(value: number): number {
  return clamp(value / 8, 0, 1)
}

function scoreCash(value: number): number {
  return clamp((value + 10000) / 20000, 0, 1)
}

function calcRisk(avgStress: number, avgSleep: number, avgMood: number): number {
  return clamp(avgStress * 10 - avgSleep * 4 + (10 - avgMood) * 3, 0, 100)
}

function calcEntropy(volatility: number, risk: number): number {
  return clamp(volatility * 22 + risk * 0.45, 0, 100)
}

function calcDrift(index: number, previousIndex?: number): number {
  if (previousIndex === undefined) return 0
  return round1(index - previousIndex)
}

export function computeCoreState(checkins: CheckinRecord[], quests: QuestRecord[], ts = Date.now()): CoreStateSnapshot {
  const latest = checkins[0]
  const avg7 = computeAverages(checkins, INDEX_METRIC_IDS, 7)
  const indexSeries = computeIndexSeries(checkins)
  const index = round1(indexSeries.at(-1) ?? 0)
  const previousIndex = indexSeries.length > 1 ? indexSeries[indexSeries.length - 2] : undefined
  const volatility = round1(computeVolatility(checkins, 'energy', 14))

  const energy = score10(latest?.energy ?? 5)
  const focus = score10(latest?.focus ?? 5)
  const mood = score10(latest?.mood ?? 5)
  const stressInverse = 1 - score10(latest?.stress ?? 5)
  const sleep = scoreSleep(latest?.sleepHours ?? 8)
  const social = score10(latest?.social ?? 5)
  const productivity = score10(latest?.productivity ?? 5)
  const health = score10(latest?.health ?? 5)
  const cash = scoreCash(latest?.cashFlow ?? 0)

  const completedQuests = quests.filter((quest) => quest.status === 'completed')
  const questXp = completedQuests.reduce((sum, quest) => sum + (quest.xpEarned ?? 0), 0)
  const questBoost = clamp(completedQuests.length * 1.2 + questXp / 60, 0, 16)

  const stats: CoreStats = {
    strength: round1(clamp((energy * 0.34 + health * 0.3 + sleep * 0.22 + stressInverse * 0.14) * 100 + questBoost * 0.5, 0, 100)),
    intelligence: round1(clamp((focus * 0.4 + productivity * 0.3 + sleep * 0.2 + cash * 0.1) * 100 + questBoost * 0.35, 0, 100)),
    wisdom: round1(clamp((mood * 0.33 + social * 0.22 + stressInverse * 0.25 + sleep * 0.2) * 100 + questBoost * 0.3, 0, 100)),
    dexterity: round1(clamp((productivity * 0.34 + energy * 0.26 + focus * 0.22 + social * 0.18) * 100 + questBoost * 0.4, 0, 100)),
  }

  const risk = round1(calcRisk(avg7.stress ?? 5, avg7.sleepHours ?? 7, avg7.mood ?? 5))
  const drift = calcDrift(index, previousIndex)
  const entropy = round1(calcEntropy(volatility, risk))

  const statAvg = (stats.strength + stats.intelligence + stats.wisdom + stats.dexterity) / 4
  const xp = Math.max(0, Math.round(statAvg * 3 + index * 14 + checkins.length * 6 + questXp + completedQuests.length * 12 - risk * 0.8 + Math.max(0, 18 - entropy) * 2))
  const level = Math.max(1, Math.floor(xp / 180) + 1)

  return { ts, index, risk, volatility, xp, level, stats, entropy, drift }
}

function metricDelta(latest?: CheckinRecord, previous?: CheckinRecord): Array<{ id: string; score: number; delta: number }> {
  if (!latest || !previous) return []
  const entries: Array<{ id: string; score: number; delta: number }> = [
    { id: 'energy', delta: latest.energy - previous.energy, score: Math.abs(latest.energy - previous.energy) },
    { id: 'focus', delta: latest.focus - previous.focus, score: Math.abs(latest.focus - previous.focus) },
    { id: 'mood', delta: latest.mood - previous.mood, score: Math.abs(latest.mood - previous.mood) },
    { id: 'stress', delta: previous.stress - latest.stress, score: Math.abs(latest.stress - previous.stress) },
    { id: 'sleepHours', delta: latest.sleepHours - previous.sleepHours, score: Math.abs(latest.sleepHours - previous.sleepHours) },
    { id: 'productivity', delta: latest.productivity - previous.productivity, score: Math.abs(latest.productivity - previous.productivity) },
  ]
  return entries.sort((a, b) => b.score - a.score)
}

const contributorLabels: Record<string, string> = {
  energy: 'Энергия',
  focus: 'Фокус',
  mood: 'Настроение',
  stress: 'Стресс',
  sleepHours: 'Сон',
  productivity: 'Продуктивность',
}

export function explainCoreState(latest: CheckinRecord | undefined, previous: CheckinRecord | undefined, activeQuest?: QuestRecord): CoreContributor[] {
  const fromDelta = metricDelta(latest, previous).slice(0, 2).map((entry) => ({
    id: `metric-${entry.id}`,
    title: contributorLabels[entry.id] ?? entry.id,
    text: `${entry.delta >= 0 ? 'Рост' : 'Снижение'}: ${entry.delta > 0 ? '+' : ''}${round1(entry.delta)}.`,
    score: round1(entry.score),
  }))

  const questContributor = activeQuest
    ? [{
      id: 'quest-driver',
      title: 'Текущая миссия',
      text: `Фокус на «${activeQuest.title}» с целевым сдвигом ${activeQuest.delta > 0 ? '+' : ''}${round1(activeQuest.delta)}.`,
      score: round1(Math.abs(activeQuest.delta) + activeQuest.predictedIndexLift),
    }]
    : [{
      id: 'quest-driver',
      title: 'Режим миссии',
      text: 'Активной миссии нет — ядро опирается только на чек-ины.',
      score: 0.1,
    }]

  return [...fromDelta, ...questContributor].slice(0, 3)
}
