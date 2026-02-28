import type { MetricId } from '../../core/metrics'
import type { GoalModePresetId } from '../../core/models/goal'

export type MissionEffectProfile = 'small' | 'medium' | 'large'
export type MissionTimeBand = 5 | 15 | 30

export interface MissionTemplate {
  id: string
  title: string
  why: string
  timeBandMinutes: MissionTimeBand
  tags?: string[]
  effectProfile: MissionEffectProfile
  ifThenPlan?: string
}

const metricMissionTemplates: Record<MetricId, MissionTemplate[]> = {
  energy: [
    { id: 'energy-light-reset', title: 'Свет + вода перед стартом', why: 'Чтобы усилить ветвь Энергия, потому что утренний ритм быстрее поднимает тонус.', timeBandMinutes: 5, effectProfile: 'small', ifThenPlan: 'Если тянет залипнуть в ленте, то сначала выпей воду и выйди на свет на 5 минут.' },
    { id: 'energy-walk', title: '15 минут прогулки без экрана', why: 'Чтобы усилить ветвь Энергия, потому что движение снимает вялость лучше кофе.', timeBandMinutes: 15, effectProfile: 'medium' },
    { id: 'energy-deep-reset', title: 'Глубокий reset: движение + дыхание', why: 'Чтобы усилить ветвь Энергия, потому что длинный reset снижает усталость до конца дня.', timeBandMinutes: 30, effectProfile: 'large', ifThenPlan: 'Если чувствуешь спад после обеда, то сделай 20 минут ходьбы и 10 минут спокойного дыхания.' },
  ],
  sleepHours: [
    { id: 'sleep-cut-caffeine', title: 'Стоп-кофеин по таймеру', why: 'Чтобы усилить ветвь Сон, потому что вечерний стимул чаще всего срывает засыпание.', timeBandMinutes: 5, effectProfile: 'small' },
    { id: 'sleep-evening-ritual', title: 'Вечерний ритуал засыпания', why: 'Чтобы усилить ветвь Сон, потому что стабильный ритуал ускоряет засыпание.', timeBandMinutes: 15, effectProfile: 'medium', ifThenPlan: 'Если в 22:30 ещё работаешь, то закрой ноутбук и включи 15-минутный ритуал без экрана.' },
    { id: 'sleep-room-reset', title: 'Подготовить комнату ко сну', why: 'Чтобы усилить ветвь Сон, потому что тишина и прохлада повышают качество ночи.', timeBandMinutes: 30, effectProfile: 'large' },
  ],
  stress: [
    { id: 'stress-breath-5', title: '5 минут дыхания 4-6', why: 'Чтобы усилить ветвь Стресс, потому что дыхание быстро сбивает перегруз.', timeBandMinutes: 5, effectProfile: 'small' },
    { id: 'stress-boundary', title: 'Одна граница против шума', why: 'Чтобы усилить ветвь Стресс, потому что один стоп-фактор сразу снижает давление.', timeBandMinutes: 15, effectProfile: 'medium' },
    { id: 'stress-unload', title: 'Полный разгрузочный слот', why: 'Чтобы усилить ветвь Стресс, потому что длинная пауза возвращает контроль.', timeBandMinutes: 30, effectProfile: 'large', ifThenPlan: 'Если начинается внутренний шторм, то отмени одну несрочную задачу и сделай 30-минутный разгрузочный слот.' },
  ],
  focus: [
    { id: 'focus-single-task', title: 'Один фокус-блок без отвлечений', why: 'Чтобы усилить ветвь Фокус, потому что один чистый блок даёт ощутимый прогресс.', timeBandMinutes: 15, effectProfile: 'medium' },
    { id: 'focus-clarify-next', title: 'Сформулировать следующий шаг', why: 'Чтобы усилить ветвь Фокус, потому что ясный шаг убирает прокрастинацию.', timeBandMinutes: 5, effectProfile: 'small' },
    { id: 'focus-two-cycles', title: 'Два цикла глубокого внимания', why: 'Чтобы усилить ветвь Фокус, потому что серия циклов закрепляет концентрацию.', timeBandMinutes: 30, effectProfile: 'large' },
  ],
  productivity: [
    { id: 'prod-top-1', title: 'Закрыть задачу №1 дня', why: 'Чтобы усилить ветвь Продуктивность, потому что главный результат снижает хаос.', timeBandMinutes: 30, effectProfile: 'large' },
    { id: 'prod-clean-backlog', title: 'Разобрать хвост из 3 задач', why: 'Чтобы усилить ветвь Продуктивность, потому что чистый хвост освобождает внимание.', timeBandMinutes: 15, effectProfile: 'medium' },
    { id: 'prod-plan-5', title: 'План на день в 3 шага', why: 'Чтобы усилить ветвь Продуктивность, потому что короткий план повышает завершения.', timeBandMinutes: 5, effectProfile: 'small', ifThenPlan: 'Если не знаешь с чего начать, то сначала запиши три шага и только потом открывай чат.' },
  ],
  mood: [
    { id: 'mood-gratitude', title: 'Три хорошие вещи дня', why: 'Чтобы усилить ветвь Настроение, потому что фиксация позитива поднимает базовый фон.', timeBandMinutes: 5, effectProfile: 'small' },
    { id: 'mood-light-walk', title: 'Прогулка на свету', why: 'Чтобы усилить ветвь Настроение, потому что свет и движение быстро стабилизируют фон.', timeBandMinutes: 15, effectProfile: 'medium' },
    { id: 'mood-recovery-hour', title: 'Большой слот восстановления', why: 'Чтобы усилить ветвь Настроение, потому что глубокий отдых снижает эмоциональный шум.', timeBandMinutes: 30, effectProfile: 'large' },
  ],
  social: [
    { id: 'social-support-msg', title: 'Сообщение поддержки', why: 'Чтобы усилить ветвь Социальность, потому что короткий контакт возвращает опору.', timeBandMinutes: 5, effectProfile: 'small' },
    { id: 'social-live-call', title: 'Короткий живой звонок', why: 'Чтобы усилить ветвь Социальность, потому что голосовой контакт укрепляет связь.', timeBandMinutes: 15, effectProfile: 'medium' },
    { id: 'social-meet-plan', title: 'Запланировать личную встречу', why: 'Чтобы усилить ветвь Социальность, потому что офлайн-связь держит ресурс надолго.', timeBandMinutes: 30, effectProfile: 'large' },
  ],
  health: [
    { id: 'health-mobility', title: 'Мягкая мобилизация тела', why: 'Чтобы усилить ветвь Здоровье, потому что микро-движение снимает зажимы.', timeBandMinutes: 15, effectProfile: 'medium' },
    { id: 'health-water', title: 'Контроль воды на день', why: 'Чтобы усилить ветвь Здоровье, потому что гидратация поддерживает ясность и выносливость.', timeBandMinutes: 5, effectProfile: 'small' },
    { id: 'health-training-lite', title: 'Полу-час активности', why: 'Чтобы усилить ветвь Здоровье, потому что длинная активность улучшает самочувствие.', timeBandMinutes: 30, effectProfile: 'large' },
  ],
  cashFlow: [
    { id: 'cashflow-check', title: 'Проверить денежный поток', why: 'Чтобы усилить ветвь Cashflow, потому что ежедневный контроль уменьшает утечки.', timeBandMinutes: 5, effectProfile: 'small' },
    { id: 'cashflow-one-action', title: 'Одно действие на доход', why: 'Чтобы усилить ветвь Cashflow, потому что регулярный шаг ускоряет рост потока.', timeBandMinutes: 15, effectProfile: 'medium' },
    { id: 'cashflow-deep-review', title: 'Разбор расходов и обязательств', why: 'Чтобы усилить ветвь Cashflow, потому что глубокий разбор снижает финансовый шум.', timeBandMinutes: 30, effectProfile: 'large' },
  ],
}

const presetPreferredBands: Record<GoalModePresetId, MissionTimeBand[]> = {
  balance: [15, 5, 30],
  recovery: [15, 30, 5],
  sprint: [30, 15, 5],
  finance: [15, 30, 5],
  'social-shield': [15, 5, 30],
}

const durationBandPreference: Record<1 | 3, MissionTimeBand[]> = {
  1: [5, 15, 30],
  3: [15, 30, 5],
}

const effectByBand: Record<MissionTimeBand, MissionEffectProfile> = {
  5: 'small',
  15: 'medium',
  30: 'large',
}

export function missionEffectRange(durationDays: 1 | 3, effectProfile: MissionEffectProfile): { min: number; max: number; expected: number } {
  if (durationDays === 1) {
    if (effectProfile === 'small') return { min: 1, max: 3, expected: 2 }
    if (effectProfile === 'medium') return { min: 2, max: 4, expected: 3 }
    return { min: 3, max: 5, expected: 4 }
  }
  if (effectProfile === 'small') return { min: 3, max: 6, expected: 4 }
  if (effectProfile === 'medium') return { min: 4, max: 8, expected: 6 }
  return { min: 6, max: 10, expected: 8 }
}

export function buildMissionSuggestion(options: {
  metricId: MetricId
  presetId: GoalModePresetId
  durationDays: 1 | 3
  excludedTemplateIds: string[]
  salt: number
}): MissionTemplate {
  const pool = metricMissionTemplates[options.metricId] ?? []
  if (pool.length === 0) {
    const fallbackBand = durationBandPreference[options.durationDays][0]
    return {
      id: `${options.metricId}-fallback-${fallbackBand}`,
      title: `Ритуал по ветви ${options.metricId}`,
      why: `Чтобы усилить ветвь ${options.metricId}, потому что регулярный ритуал создаёт устойчивый прогресс.`,
      timeBandMinutes: fallbackBand,
      effectProfile: effectByBand[fallbackBand],
    }
  }

  const excluded = new Set(options.excludedTemplateIds)
  const durationOrder = durationBandPreference[options.durationDays]
  const presetOrder = presetPreferredBands[options.presetId]
  const score = (template: MissionTemplate) => {
    const durationRank = durationOrder.indexOf(template.timeBandMinutes)
    const presetRank = presetOrder.indexOf(template.timeBandMinutes)
    return (durationRank < 0 ? 9 : durationRank) + (presetRank < 0 ? 9 : presetRank)
  }

  const ranked = [...pool].sort((a, b) => score(a) - score(b))
  const eligible = ranked.filter((template) => !excluded.has(template.id))
  const source = eligible.length > 0 ? eligible : ranked
  const index = Math.abs(options.salt) % source.length
  return source[index]
}
