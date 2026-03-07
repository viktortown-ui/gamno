import type { MetricId } from '../../core/metrics'
import type { GoalMission, GoalModePresetId, GoalRecord } from '../../core/models/goal'

export type MissionTag = 'energy' | 'sleep' | 'focus' | 'money' | 'social' | 'stress'

export interface MissionTemplate {
  id: string
  title: string
  why: string
  costMinutes: 15 | 30 | 45 | 60
  effect: { min: number; max: number; unit: 'ед.' }
  tags?: MissionTag[]
  ifThenPlan?: string
}

const fallbackTemplate: MissionTemplate = {
  id: 'fallback-checkin',
  title: 'Калибровка / чек-ин',
  why: 'Данных для точного шага пока мало, поэтому короткая калибровка стабилизирует курс и проясняет следующее действие.',
  costMinutes: 15,
  effect: { min: 2, max: 4, unit: 'ед.' },
}

const templatesByMetric: Partial<Record<MetricId, MissionTemplate[]>> = {
  energy: [
    { id: 'energy-reset', title: 'Глубокий ресет', why: 'Энергия просела: короткий цикл восстановления вернёт управляемость и снимет вялость.', costMinutes: 30, effect: { min: 6, max: 10, unit: 'ед.' }, tags: ['energy', 'stress'] },
    { id: 'energy-walk', title: 'Прогулка без экрана', why: 'Движение и свет поднимают тонус и дают чистый старт следующему блоку.', costMinutes: 45, effect: { min: 5, max: 8, unit: 'ед.' }, tags: ['energy'] },
  ],
  sleepHours: [
    { id: 'sleep-evening', title: 'Вечерний протокол сна', why: 'Сон — базовый рычаг: стабильный ритуал снижает шум и ускоряет засыпание.', costMinutes: 30, effect: { min: 4, max: 7, unit: 'ед.' }, tags: ['sleep'] },
  ],
  stress: [
    { id: 'stress-unload', title: 'Разгрузочный слот', why: 'Стресс стал узким местом: контролируемая пауза снижает перегрев и возвращает фокус.', costMinutes: 45, effect: { min: 5, max: 9, unit: 'ед.' }, tags: ['stress'] },
  ],
  focus: [
    { id: 'focus-deep', title: 'Один глубокий блок', why: 'Фокус ослаб: один завершённый блок создаст тягу и уменьшит прокрастинацию.', costMinutes: 60, effect: { min: 6, max: 10, unit: 'ед.' }, tags: ['focus'] },
  ],
  productivity: [
    { id: 'productivity-top1', title: 'Закрыть задачу №1', why: 'Главный результат дня убирает хаос и даёт сильный прирост по цели.', costMinutes: 60, effect: { min: 7, max: 10, unit: 'ед.' }, tags: ['focus'] },
  ],
  cashFlow: [
    { id: 'money-review', title: 'Финансовый мини-разбор', why: 'Контроль денежного контура снижает неопределённость и убирает утечки.', costMinutes: 30, effect: { min: 4, max: 8, unit: 'ед.' }, tags: ['money'] },
  ],
  social: [
    { id: 'social-call', title: 'Опорный контакт', why: 'Короткий живой контакт возвращает опору и снижает риск изоляции.', costMinutes: 15, effect: { min: 3, max: 5, unit: 'ед.' }, tags: ['social'] },
  ],
  mood: [
    { id: 'mood-reset', title: 'Перезапуск состояния', why: 'Нейтрализация эмоционального шума помогает удержать темп без срыва.', costMinutes: 30, effect: { min: 4, max: 7, unit: 'ед.' }, tags: ['energy', 'stress'] },
  ],
  health: [
    { id: 'health-mobility', title: 'Мобилизация тела', why: 'Снятие зажимов возвращает ресурс и поддерживает устойчивость на дистанции.', costMinutes: 30, effect: { min: 4, max: 7, unit: 'ед.' }, tags: ['energy'] },
  ],
}

const presetFallbackMetric: Record<GoalModePresetId, MetricId> = {
  balance: 'energy',
  recovery: 'sleepHours',
  sprint: 'focus',
  finance: 'cashFlow',
  'social-shield': 'social',
}

export function resolveWeakLever(goal: GoalRecord): { leverId: string | null; metricId: MetricId | null } {
  const rows = goal.okr.keyResults
  if (rows.length === 0) return { leverId: null, metricId: null }
  const sorted = [...rows].sort((a, b) => {
    const ap = typeof a.progress === 'number' ? a.progress : 0.5
    const bp = typeof b.progress === 'number' ? b.progress : 0.5
    return ap - bp
  })
  const weak = sorted[0]
  return { leverId: weak.id, metricId: weak.metricId }
}

export function pickMissionTemplate(goal: GoalRecord): MissionTemplate {
  const weak = resolveWeakLever(goal)
  const metricId = weak.metricId ?? presetFallbackMetric[goal.modePresetId ?? 'balance']
  const pool = templatesByMetric[metricId] ?? []
  if (!pool.length) return fallbackTemplate

  const history = (goal.missions ?? []).map((item) => item.id).join('|')
  const saltBase = `${goal.id}:${metricId}:${history.length}:${history}`
  let hash = 0
  for (let i = 0; i < saltBase.length; i += 1) hash = (hash * 31 + saltBase.charCodeAt(i)) >>> 0
  return pool[hash % pool.length]
}

export function buildProposedMission(goal: GoalRecord, now = Date.now()): GoalMission {
  const template = pickMissionTemplate(goal)
  const weak = resolveWeakLever(goal)
  return {
    id: `mission-${goal.id}-${now}`,
    goalId: goal.id,
    leverId: weak.leverId,
    title: template.title,
    why: template.why,
    effect: template.effect,
    costMinutes: template.costMinutes,
    status: 'предложена',
    createdAt: now,
    updatedAt: now,
  }
}

export function getActiveMission(goal: GoalRecord): GoalMission | undefined {
  return (goal.missions ?? []).find((item) => item.status === 'предложена' || item.status === 'принята')
}

export type MissionEffectProfile = 'small' | 'medium' | 'large'

export function missionEffectRange(_durationDays: 1 | 3, effectProfile: MissionEffectProfile): { min: number; max: number; expected: number } {
  if (effectProfile === 'small') return { min: 2, max: 4, expected: 3 }
  if (effectProfile === 'medium') return { min: 4, max: 7, expected: 5 }
  return { min: 6, max: 10, expected: 8 }
}

export function buildMissionSuggestion(options: {
  metricId: MetricId
  presetId: GoalModePresetId
  durationDays: 1 | 3
  excludedTemplateIds: string[]
  avoidTags?: MissionTag[]
  salt: number
}): {
  id: string
  title: string
  why: string
  timeBandMinutes: 5 | 15 | 30
  effectProfile: MissionEffectProfile
  tags?: MissionTag[]
  ifThenPlan?: string
} {
  const goal: GoalRecord = {
    id: `compat-${options.metricId}`,
    createdAt: 0,
    updatedAt: 0,
    title: 'compat',
    horizonDays: 14,
    active: true,
    weights: {},
    okr: { objective: '', keyResults: [{ id: `kr-${options.metricId}`, metricId: options.metricId, direction: 'up', progress: 0.2 }] },
    modePresetId: options.presetId,
    status: 'active',
    missions: options.excludedTemplateIds.map((id, idx) => ({
      id,
      goalId: 'compat',
      leverId: null,
      title: 'x',
      why: 'x',
      effect: { min: 1, max: 1, unit: 'ед.' },
      costMinutes: 15,
      status: 'выполнена',
      createdAt: idx,
      updatedAt: idx,
      doneAt: idx,
    })),
  }
  const picked = pickMissionTemplate(goal)
  const timeBandMinutes: 5 | 15 | 30 = picked.costMinutes <= 15 ? 15 : picked.costMinutes <= 30 ? 30 : 30
  const effectProfile: MissionEffectProfile = picked.effect.max >= 8 ? 'large' : picked.effect.max >= 6 ? 'medium' : 'small'
  return { id: picked.id, title: picked.title, why: picked.why, timeBandMinutes, effectProfile, tags: picked.tags, ifThenPlan: undefined }
}
