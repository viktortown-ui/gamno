import type { MetricId } from '../../core/metrics'
import type { GoalModePresetId, GoalRecord, Mission } from '../../core/models/goal'

export type MissionTag = 'energy' | 'sleep' | 'focus' | 'money' | 'stress' | 'recovery' | 'checkin' | 'productivity' | 'social'

export interface MissionTemplate {
  id: string
  title: string
  why: string
  effectText: string
  costMinutes: Mission['costMinutes']
  tags?: MissionTag[]
  ifThenPlan?: string
}

const fallbackTemplate: MissionTemplate = {
  id: 'universal-checkin',
  title: 'Чек-ин и калибровка',
  why: 'Короткая калибровка проясняет, где застрял прогресс, и возвращает управляемость.',
  effectText: 'Снижается туман и становится понятен следующий шаг.',
  costMinutes: 15,
  tags: ['checkin'],
}

const templatesByMetric: Partial<Record<MetricId, MissionTemplate>> = {
  energy: { id: 'energy-walk', title: 'Прогулка без экрана', why: 'Энергия просела — движение и воздух быстро поднимут тонус.', effectText: 'Больше ресурса и устойчивости для следующего действия.', costMinutes: 30, tags: ['energy', 'recovery'] },
  sleepHours: { id: 'sleep-quiet-hour', title: 'Тихий час перед сном', why: 'Сон расшатан: мягкий ритуал снижает перегрев и упрощает засыпание.', effectText: 'Стабильнее восстановление и ясность утром.', costMinutes: 45, tags: ['sleep', 'recovery'] },
  stress: { id: 'stress-reset-10', title: 'Сброс напряжения на 10 минут', why: 'Стресс стал узким местом — пауза вернёт контроль над вниманием.', effectText: 'Меньше внутреннего шума и импульсивных решений.', costMinutes: 10, tags: ['stress', 'recovery'] },
  focus: { id: 'focus-closed-block', title: 'Один закрытый блок без отвлечений', why: 'Фокус проседает, поэтому нужен один завершённый кусок работы.', effectText: 'Возвращается чувство продвижения и темп.', costMinutes: 30, tags: ['focus', 'productivity'] },
  productivity: { id: 'productivity-tail', title: 'Добить один зависший хвост', why: 'Подвисшие хвосты съедают импульс и усиливают прокрастинацию.', effectText: 'Освобождается внимание и растёт скорость исполнения.', costMinutes: 25, tags: ['productivity'] },
  cashFlow: { id: 'money-leak-check', title: 'Быстрый контроль утечки', why: 'Деньги/ресурс проседают — нужна короткая проверка утекающих трат.', effectText: 'Снижается неопределённость и укрепляется опора.', costMinutes: 20, tags: ['money'] },
  health: { id: 'recovery-soft', title: 'Мягкое восстановление тела', why: 'Телу не хватает восстановления, это блокирует остальные ветви.', effectText: 'Больше ресурса на цель без перегрева.', costMinutes: 20, tags: ['recovery'] },
}

const presetFallbackMetric: Record<GoalModePresetId, MetricId> = {
  balance: 'energy',
  recovery: 'sleepHours',
  sprint: 'focus',
  finance: 'cashFlow',
  'social-shield': 'stress',
}

export function resolveWeakLever(goal: GoalRecord): { leverId: string | null; metricId: MetricId | null } {
  const rows = goal.okr.keyResults
  if (rows.length === 0) return { leverId: null, metricId: null }
  const weak = [...rows].sort((a, b) => (typeof a.progress === 'number' ? a.progress : 0.5) - (typeof b.progress === 'number' ? b.progress : 0.5))[0]
  return { leverId: weak.id, metricId: weak.metricId }
}

export function pickMissionTemplate(goal: GoalRecord): MissionTemplate {
  const weak = resolveWeakLever(goal)
  const metricId = weak.metricId ?? presetFallbackMetric[goal.modePresetId ?? 'balance']
  return templatesByMetric[metricId] ?? fallbackTemplate
}

export function buildProposedMission(goal: GoalRecord, now = Date.now()): Mission {
  const template = pickMissionTemplate(goal)
  const weak = resolveWeakLever(goal)
  return {
    id: `mission-${goal.id}-${now}`,
    goalId: goal.id,
    leverId: weak.leverId,
    title: template.title,
    why: template.why,
    effectText: template.effectText,
    costMinutes: template.costMinutes,
    status: 'suggested',
    createdAt: now,
    updatedAt: now,
  }
}

export function getActiveMission(goal: GoalRecord): Mission | undefined {
  return (goal.missions ?? []).find((item) => item.status === 'suggested' || item.status === 'accepted' || item.status === 'snoozed')
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
  const template = templatesByMetric[options.metricId] ?? fallbackTemplate
  const timeBandMinutes: 5 | 15 | 30 = template.costMinutes <= 15 ? 15 : 30
  const effectProfile: MissionEffectProfile = template.costMinutes >= 30 ? 'large' : template.costMinutes >= 20 ? 'medium' : 'small'
  return { id: template.id, title: template.title, why: template.why, timeBandMinutes, effectProfile, tags: template.tags, ifThenPlan: undefined }
}
