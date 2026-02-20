import type { ActionContext, ActionDefinition, ActionState } from './types'

interface ActionBlueprint {
  id: string
  titleRu: string
  domain: ActionDefinition['domain']
  tags: ActionDefinition['tags']
  cost: ActionDefinition['defaultCost']
  delta: ReturnType<ActionDefinition['effectsFn']>
  precondition: (state: ActionState, ctx: ActionContext) => boolean
}

function allowAlways(): (state: ActionState, ctx: ActionContext) => boolean {
  return () => true
}

const CATALOG_BLUEPRINTS: ActionBlueprint[] = [
  { id: 'focus:deep-25', titleRu: 'Глубокий фокус 25 минут', domain: 'фокус', tags: ['goal'], cost: { timeMin: 25, energy: 12, money: 0, timeDebt: 0.05, risk: 0.02, entropy: -0.08 }, delta: { goalScore: 2.1, index: 0.32, pCollapse: -0.006, tailRisk: -0.004, debt: 0.03, sirenRisk: -0.006 }, precondition: allowAlways() },
  { id: 'focus:no-notify-60', titleRu: 'Отключить уведомления на 60 минут', domain: 'фокус', tags: ['goal', 'risk'], cost: { timeMin: 5, energy: 2, money: 0, timeDebt: -0.02, risk: -0.03, entropy: -0.1 }, delta: { goalScore: 1.4, index: 0.21, pCollapse: -0.005, tailRisk: -0.003, debt: -0.02, sirenRisk: -0.005 }, precondition: allowAlways() },
  { id: 'focus:plan-3', titleRu: 'План на 3 ключевых шага', domain: 'фокус', tags: ['goal', 'recovery'], cost: { timeMin: 15, energy: 4, money: 0, timeDebt: -0.06, risk: -0.02, entropy: -0.15 }, delta: { goalScore: 1.2, index: 0.18, pCollapse: -0.004, tailRisk: -0.003, debt: -0.04, sirenRisk: -0.004 }, precondition: allowAlways() },
  { id: 'focus:email-batch', titleRu: 'Пакетная обработка почты', domain: 'карьера', tags: ['goal'], cost: { timeMin: 20, energy: 8, money: 0, timeDebt: -0.03, risk: -0.01, entropy: -0.05 }, delta: { goalScore: 1.0, index: 0.14, pCollapse: -0.002, tailRisk: -0.002, debt: -0.03, sirenRisk: -0.002 }, precondition: allowAlways() },
  { id: 'focus:clean-desktop', titleRu: 'Очистить рабочий стол', domain: 'фокус', tags: ['recovery'], cost: { timeMin: 10, energy: 3, money: 0, timeDebt: -0.08, risk: -0.02, entropy: -0.2 }, delta: { goalScore: 0.8, index: 0.1, pCollapse: -0.003, tailRisk: -0.002, debt: -0.05, sirenRisk: -0.003 }, precondition: allowAlways() },
  { id: 'health:walk-20', titleRu: 'Прогулка 20 минут', domain: 'здоровье', tags: ['recovery', 'risk'], cost: { timeMin: 20, energy: 6, money: 0, timeDebt: 0, risk: -0.08, entropy: -0.06 }, delta: { goalScore: 1.1, index: 0.16, pCollapse: -0.01, tailRisk: -0.009, debt: -0.02, sirenRisk: -0.012 }, precondition: (s) => s.sirenLevel >= 0.2 },
  { id: 'health:water-500', titleRu: 'Выпить 500 мл воды', domain: 'здоровье', tags: ['recovery'], cost: { timeMin: 3, energy: 1, money: 0, timeDebt: -0.01, risk: -0.01, entropy: -0.02 }, delta: { goalScore: 0.5, index: 0.07, pCollapse: -0.001, tailRisk: -0.001, debt: -0.01, sirenRisk: -0.001 }, precondition: allowAlways() },
  { id: 'health:stretch-10', titleRu: 'Растяжка 10 минут', domain: 'здоровье', tags: ['recovery'], cost: { timeMin: 10, energy: 3, money: 0, timeDebt: 0, risk: -0.03, entropy: -0.04 }, delta: { goalScore: 0.7, index: 0.1, pCollapse: -0.004, tailRisk: -0.003, debt: -0.01, sirenRisk: -0.005 }, precondition: allowAlways() },
  { id: 'health:sleep-early', titleRu: 'Сон: лечь на 45 минут раньше', domain: 'восстановление', tags: ['risk', 'recovery'], cost: { timeMin: 15, energy: 2, money: 0, timeDebt: -0.2, risk: -0.12, entropy: -0.1 }, delta: { goalScore: 1.6, index: 0.2, pCollapse: -0.016, tailRisk: -0.012, debt: -0.1, sirenRisk: -0.02 }, precondition: (s) => s.sirenLevel >= 0.2 || s.pCollapse >= 0.2 },
  { id: 'health:breath-5', titleRu: 'Дыхание 5 минут', domain: 'восстановление', tags: ['risk', 'recovery'], cost: { timeMin: 5, energy: 1, money: 0, timeDebt: -0.01, risk: -0.05, entropy: -0.08 }, delta: { goalScore: 0.8, index: 0.08, pCollapse: -0.007, tailRisk: -0.006, debt: -0.01, sirenRisk: -0.009 }, precondition: (s) => s.sirenLevel >= 0.2 },
  { id: 'career:doc-30', titleRu: 'Закрыть один рабочий документ', domain: 'карьера', tags: ['goal'], cost: { timeMin: 30, energy: 14, money: 0, timeDebt: 0.08, risk: 0.01, entropy: -0.04 }, delta: { goalScore: 2.0, index: 0.29, pCollapse: -0.002, tailRisk: -0.001, debt: 0.04, sirenRisk: -0.001 }, precondition: (s) => s.goalGap > -10 },
  { id: 'career:call-15', titleRu: 'Созвон по блоку 15 минут', domain: 'карьера', tags: ['goal'], cost: { timeMin: 15, energy: 9, money: 0, timeDebt: 0.03, risk: 0.02, entropy: -0.02 }, delta: { goalScore: 1.3, index: 0.19, pCollapse: -0.001, tailRisk: 0.001, debt: 0.03, sirenRisk: 0.001 }, precondition: allowAlways() },
  { id: 'career:backlog-1', titleRu: 'Разобрать 1 элемент бэклога', domain: 'карьера', tags: ['goal', 'recovery'], cost: { timeMin: 20, energy: 8, money: 0, timeDebt: -0.04, risk: -0.01, entropy: -0.07 }, delta: { goalScore: 1.1, index: 0.15, pCollapse: -0.003, tailRisk: -0.002, debt: -0.04, sirenRisk: -0.002 }, precondition: allowAlways() },
  { id: 'career:status-update', titleRu: 'Короткий статус-апдейт', domain: 'карьера', tags: ['goal'], cost: { timeMin: 8, energy: 4, money: 0, timeDebt: -0.02, risk: -0.01, entropy: -0.03 }, delta: { goalScore: 0.7, index: 0.1, pCollapse: -0.002, tailRisk: -0.001, debt: -0.02, sirenRisk: -0.002 }, precondition: allowAlways() },
  { id: 'career:review-10', titleRu: 'Ревью 10 минут', domain: 'карьера', tags: ['goal'], cost: { timeMin: 10, energy: 6, money: 0, timeDebt: 0.01, risk: 0, entropy: -0.02 }, delta: { goalScore: 0.9, index: 0.12, pCollapse: -0.001, tailRisk: -0.001, debt: 0.01, sirenRisk: -0.001 }, precondition: allowAlways() },
  { id: 'finance:budget-15', titleRu: 'Проверить бюджет на неделю', domain: 'финансы', tags: ['risk', 'recovery'], cost: { timeMin: 15, energy: 5, money: 0, timeDebt: -0.05, risk: -0.06, entropy: -0.06 }, delta: { goalScore: 0.9, index: 0.11, pCollapse: -0.006, tailRisk: -0.005, debt: -0.04, sirenRisk: -0.006 }, precondition: allowAlways() },
  { id: 'finance:pay-bill', titleRu: 'Оплатить обязательный счёт', domain: 'финансы', tags: ['risk'], cost: { timeMin: 10, energy: 3, money: 1200, timeDebt: -0.12, risk: -0.1, entropy: -0.03 }, delta: { goalScore: 1.0, index: 0.1, pCollapse: -0.01, tailRisk: -0.009, debt: -0.08, sirenRisk: -0.01 }, precondition: (s) => s.debtTotal > 0.5 },
  { id: 'finance:cancel-sub', titleRu: 'Отключить лишнюю подписку', domain: 'финансы', tags: ['risk', 'recovery'], cost: { timeMin: 12, energy: 4, money: -300, timeDebt: -0.04, risk: -0.04, entropy: -0.04 }, delta: { goalScore: 0.8, index: 0.09, pCollapse: -0.004, tailRisk: -0.003, debt: -0.03, sirenRisk: -0.004 }, precondition: allowAlways() },
  { id: 'finance:reserve-10', titleRu: 'Резерв: отложить 10%', domain: 'финансы', tags: ['risk'], cost: { timeMin: 6, energy: 2, money: 500, timeDebt: -0.01, risk: -0.05, entropy: -0.02 }, delta: { goalScore: 0.7, index: 0.08, pCollapse: -0.005, tailRisk: -0.004, debt: -0.01, sirenRisk: -0.004 }, precondition: allowAlways() },
  { id: 'finance:invoice-1', titleRu: 'Выставить один счёт', domain: 'финансы', tags: ['goal'], cost: { timeMin: 14, energy: 7, money: -2000, timeDebt: 0.02, risk: 0, entropy: -0.03 }, delta: { goalScore: 1.4, index: 0.2, pCollapse: -0.001, tailRisk: -0.001, debt: 0.02, sirenRisk: -0.001 }, precondition: allowAlways() },
  { id: 'social:message-1', titleRu: 'Написать поддерживающее сообщение', domain: 'социальное', tags: ['recovery'], cost: { timeMin: 5, energy: 2, money: 0, timeDebt: -0.01, risk: -0.02, entropy: -0.02 }, delta: { goalScore: 0.6, index: 0.07, pCollapse: -0.003, tailRisk: -0.002, debt: -0.01, sirenRisk: -0.003 }, precondition: allowAlways() },
  { id: 'social:sync-20', titleRu: 'Синк с партнёром 20 минут', domain: 'социальное', tags: ['recovery', 'goal'], cost: { timeMin: 20, energy: 7, money: 0, timeDebt: 0.02, risk: -0.03, entropy: -0.05 }, delta: { goalScore: 1.0, index: 0.13, pCollapse: -0.004, tailRisk: -0.003, debt: 0.01, sirenRisk: -0.004 }, precondition: allowAlways() },
  { id: 'social:boundary-yes-no', titleRu: 'Уточнить границы: что да/нет', domain: 'социальное', tags: ['risk', 'recovery'], cost: { timeMin: 12, energy: 6, money: 0, timeDebt: -0.03, risk: -0.04, entropy: -0.09 }, delta: { goalScore: 0.9, index: 0.1, pCollapse: -0.005, tailRisk: -0.004, debt: -0.02, sirenRisk: -0.005 }, precondition: (s) => s.sirenLevel >= 0.2 },
  { id: 'social:mentor-note', titleRu: 'Короткая заметка ментору', domain: 'социальное', tags: ['goal'], cost: { timeMin: 8, energy: 3, money: 0, timeDebt: -0.02, risk: -0.01, entropy: -0.03 }, delta: { goalScore: 0.8, index: 0.11, pCollapse: -0.002, tailRisk: -0.002, debt: -0.02, sirenRisk: -0.002 }, precondition: allowAlways() },
  { id: 'social:family-15', titleRu: 'Время с семьёй 15 минут без экрана', domain: 'социальное', tags: ['recovery', 'risk'], cost: { timeMin: 15, energy: 4, money: 0, timeDebt: -0.03, risk: -0.05, entropy: -0.05 }, delta: { goalScore: 0.9, index: 0.1, pCollapse: -0.006, tailRisk: -0.005, debt: -0.02, sirenRisk: -0.007 }, precondition: allowAlways() },
  { id: 'recovery:debt-triage', titleRu: 'Триаж долгов задач', domain: 'восстановление', tags: ['risk', 'recovery'], cost: { timeMin: 18, energy: 6, money: 0, timeDebt: -0.18, risk: -0.06, entropy: -0.14 }, delta: { goalScore: 1.3, index: 0.14, pCollapse: -0.009, tailRisk: -0.007, debt: -0.12, sirenRisk: -0.011 }, precondition: (s) => s.debtTotal > 0.2 },
  { id: 'recovery:desk-reset', titleRu: 'Сброс окружения рабочего места', domain: 'восстановление', tags: ['recovery'], cost: { timeMin: 12, energy: 4, money: 0, timeDebt: -0.06, risk: -0.02, entropy: -0.16 }, delta: { goalScore: 0.8, index: 0.09, pCollapse: -0.003, tailRisk: -0.003, debt: -0.05, sirenRisk: -0.004 }, precondition: allowAlways() },
  { id: 'recovery:journal-10', titleRu: 'Рефлексия 10 минут', domain: 'восстановление', tags: ['recovery', 'risk'], cost: { timeMin: 10, energy: 3, money: 0, timeDebt: -0.02, risk: -0.04, entropy: -0.09 }, delta: { goalScore: 0.9, index: 0.1, pCollapse: -0.005, tailRisk: -0.004, debt: -0.02, sirenRisk: -0.006 }, precondition: allowAlways() },
  { id: 'recovery:micro-shock-focus', titleRu: 'Микро-встряска фокуса 20 минут', domain: 'фокус', tags: ['goal', 'shock'], cost: { timeMin: 20, energy: 10, money: 0, timeDebt: 0.06, risk: 0.08, entropy: 0.02 }, delta: { goalScore: 1.5, index: 0.24, pCollapse: 0.004, tailRisk: 0.005, debt: 0.04, sirenRisk: 0.004 }, precondition: (s, ctx) => ctx.mode === 'growth' && s.sirenLevel <= 0.2 && s.shockBudget > 0 && s.recoveryScore >= 55 },
  { id: 'recovery:pause-2', titleRu: 'Пауза 2 минуты перед решением', domain: 'восстановление', tags: ['risk'], cost: { timeMin: 2, energy: 1, money: 0, timeDebt: -0.01, risk: -0.03, entropy: -0.05 }, delta: { goalScore: 0.4, index: 0.04, pCollapse: -0.003, tailRisk: -0.002, debt: -0.01, sirenRisk: -0.004 }, precondition: allowAlways() },
  { id: 'recovery:single-task', titleRu: 'Одна задача без переключений', domain: 'фокус', tags: ['goal', 'risk'], cost: { timeMin: 25, energy: 10, money: 0, timeDebt: -0.04, risk: -0.02, entropy: -0.1 }, delta: { goalScore: 1.6, index: 0.23, pCollapse: -0.004, tailRisk: -0.003, debt: -0.02, sirenRisk: -0.004 }, precondition: allowAlways() },
  { id: 'recovery:no-meeting-block', titleRu: 'Окно без встреч 90 минут', domain: 'карьера', tags: ['goal', 'recovery'], cost: { timeMin: 10, energy: 5, money: 0, timeDebt: -0.05, risk: -0.02, entropy: -0.12 }, delta: { goalScore: 1.2, index: 0.17, pCollapse: -0.004, tailRisk: -0.003, debt: -0.03, sirenRisk: -0.004 }, precondition: allowAlways() },
  { id: 'recovery:weekly-retro', titleRu: 'Недельная ретроспектива', domain: 'восстановление', tags: ['goal', 'recovery'], cost: { timeMin: 30, energy: 8, money: 0, timeDebt: -0.09, risk: -0.03, entropy: -0.18 }, delta: { goalScore: 1.5, index: 0.2, pCollapse: -0.006, tailRisk: -0.005, debt: -0.07, sirenRisk: -0.007 }, precondition: allowAlways() },
]

export function buildUnifiedActionCatalog(): ActionDefinition[] {
  return CATALOG_BLUEPRINTS.map((blueprint) => ({
    id: blueprint.id,
    titleRu: blueprint.titleRu,
    domain: blueprint.domain,
    tags: [...blueprint.tags],
    defaultCost: { ...blueprint.cost },
    preconditions: blueprint.precondition,
    effectsFn: () => ({ ...blueprint.delta }),
  }))
}
