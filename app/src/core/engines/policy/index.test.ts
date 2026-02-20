import { describe, expect, it } from 'vitest'
import { defaultInfluenceMatrix } from '../influence/influence'
import { buildActionLibrary, buildStateVector, evaluatePolicies, type PolicyConstraints } from './index'
import type { CheckinRecord } from '../../models/checkin'

const checkin: CheckinRecord = {
  ts: 1710000000000,
  energy: 6,
  focus: 6,
  mood: 6,
  stress: 4,
  sleepHours: 7,
  social: 5,
  productivity: 6,
  health: 6,
  cashFlow: 1000,
}

const constraints: PolicyConstraints = {
  maxPCollapse: 0.02,
  sirenCap: 0.02,
  maxDebtGrowth: 0.2,
}

describe('policy engine', () => {
  it('детерминирован при одинаковом входе', () => {
    const state = buildStateVector({
      latestCheckin: checkin,
      checkins: [checkin],
      activeGoal: null,
      regimeSnapshot: { ts: checkin.ts, dayKey: '2024-03-09', regimeId: 1, pCollapse: 0.21, sirenLevel: 'amber', explainTop3: [] },
    })
    const actions = buildActionLibrary({
      latestCheckin: checkin,
      baseVector: {
        energy: 6, focus: 6, mood: 6, stress: 4, sleepHours: 7, social: 5, productivity: 6, health: 6, cashFlow: 1000,
      },
      matrix: defaultInfluenceMatrix,
      activeGoal: null,
      regimeSnapshot: { ts: checkin.ts, dayKey: '2024-03-09', regimeId: 1, pCollapse: 0.21, sirenLevel: 'amber', explainTop3: [] },
    })

    const first = evaluatePolicies({ state, actions, constraints })
    const second = evaluatePolicies({ state, actions, constraints })
    expect(first).toEqual(second)
  })

  it('режим осторожный отсекает рост риска сирены по ограничению', () => {
    const state = buildStateVector({ latestCheckin: checkin, checkins: [checkin], activeGoal: null })
    const result = evaluatePolicies({
      state,
      actions: [{
        id: 'x',
        titleRu: 'Агрессивный ход',
        type: 'graph',
        parameters: { delta: 1, lag: 0, horizon: 2 },
        tags: ['goal'],
      }],
      constraints: {
        maxPCollapse: -1,
        sirenCap: -1,
        maxDebtGrowth: -1,
      },
    })

    expect(result[0].best.action.id).toContain('risk:hold')
  })

  it('при ухудшении pCollapse в приоритете восстановление/риск', () => {
    const stable = evaluatePolicies({
      state: { ...buildStateVector({ latestCheckin: checkin, checkins: [checkin], activeGoal: null }), pCollapse: 0.1, sirenLevel: 0.2 },
      actions: [{ id: 'risk-step', titleRu: 'Разрядка', type: 'siren', parameters: { delta: -1, lag: 0, horizon: 2 }, tags: ['risk', 'recovery'] }, { id: 'growth', titleRu: 'Рост', type: 'graph', parameters: { delta: 1, lag: 0, horizon: 2 }, tags: ['goal'] }],
      constraints,
    })
    const stressed = evaluatePolicies({
      state: { ...buildStateVector({ latestCheckin: checkin, checkins: [checkin], activeGoal: null }), pCollapse: 0.5, sirenLevel: 1 },
      actions: [{ id: 'risk-step', titleRu: 'Разрядка', type: 'siren', parameters: { delta: -1, lag: 0, horizon: 2 }, tags: ['risk', 'recovery'] }, { id: 'growth', titleRu: 'Рост', type: 'graph', parameters: { delta: 1, lag: 0, horizon: 2 }, tags: ['goal'] }],
      constraints,
    })

    expect(stressed[0].best.action.id).toBe('risk-step')
    expect(stable[2].best.action.id).toBe('growth')
  })
})
