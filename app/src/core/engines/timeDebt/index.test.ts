import { describe, expect, it } from 'vitest'
import { buildDailySeries, buildProtocol, computeDebts, defaultTimeDebtRules } from './index'
import type { CheckinRecord } from '../../models/checkin'
import { defaultInfluenceMatrix } from '../influence/influence'

function makeCheckin(ts: number, patch?: Partial<CheckinRecord>): CheckinRecord {
  return {
    ts,
    energy: 6,
    focus: 6,
    mood: 6,
    stress: 4,
    sleepHours: 7,
    social: 6,
    productivity: 6,
    health: 6,
    cashFlow: 0,
    ...patch,
  }
}

describe('timeDebt engine', () => {
  it('детерминированный расчёт долгов', () => {
    const checkins = [
      makeCheckin(1),
      makeCheckin(2, { sleepHours: 5.5, stress: 7 }),
      makeCheckin(3, { focus: 4, productivity: 4 }),
    ]
    const series = buildDailySeries(checkins)
    const first = computeDebts(series, [], defaultTimeDebtRules)
    const second = computeDebts(series, [], defaultTimeDebtRules)
    expect(first).toEqual(second)
  })

  it('монотонность: хуже сон => выше sleepDebt', () => {
    const base = computeDebts(buildDailySeries([makeCheckin(1, { sleepHours: 7.4 })]), [], defaultTimeDebtRules)
    const worse = computeDebts(buildDailySeries([makeCheckin(1, { sleepHours: 4.8 })]), [], defaultTimeDebtRules)
    expect(worse.sleepDebt).toBeGreaterThan(base.sleepDebt)
  })

  it('долг снижается при погашении', () => {
    const high = computeDebts(buildDailySeries([makeCheckin(1, { sleepHours: 4.5, stress: 8 }), makeCheckin(2, { sleepHours: 5 })]), [], defaultTimeDebtRules)
    const repaid = computeDebts(buildDailySeries([makeCheckin(1, { sleepHours: 4.5, stress: 8 }), makeCheckin(2, { sleepHours: 8, stress: 3 })]), [], defaultTimeDebtRules)
    expect(repaid.sleepDebt).toBeLessThan(high.sleepDebt)
  })

  it('протокол ограничен 3 действиями', () => {
    const protocol = buildProtocol({
      debts: { sleepDebt: 2, recoveryDebt: 1.5, focusDebt: 1.2, socialDebt: 0.8 },
      sirenLevel: 'green',
      activeGoal: null,
      latestCheckin: makeCheckin(Date.now()),
      matrix: defaultInfluenceMatrix,
    })
    expect(protocol.length).toBeLessThanOrEqual(3)
  })

  it('при RED сирене есть действие разрядки', () => {
    const protocol = buildProtocol({
      debts: { sleepDebt: 2, recoveryDebt: 1.5, focusDebt: 1.2, socialDebt: 0.8 },
      sirenLevel: 'red',
      activeGoal: null,
      latestCheckin: makeCheckin(Date.now()),
      matrix: defaultInfluenceMatrix,
    })
    expect(protocol.some((item) => item.isDischarge)).toBe(true)
  })
})
