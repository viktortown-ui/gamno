import { db } from '../core/storage/db'
import type { TimeDebtRules, TimeDebtSnapshotRecord } from '../core/models/timeDebt'
import { buildDailySeries, buildExplainTop3, buildProtocol, computeDebts, defaultTimeDebtRules } from '../core/engines/timeDebt'
import { dayKeyFromTs } from '../core/utils/dayKey'
import { resolveActiveMatrix } from '../core/engines/influence/weightsSource'
import { defaultInfluenceMatrix } from '../core/engines/influence/influence'

const SETTINGS_KEY = 'time-debt-rules'

export async function getSettings(): Promise<TimeDebtRules> {
  const row = await db.timeDebtRules.get(SETTINGS_KEY)
  return row?.value ?? defaultTimeDebtRules
}

export async function saveSettings(value: TimeDebtRules): Promise<void> {
  await db.timeDebtRules.put({ key: SETTINGS_KEY, value, updatedAt: Date.now() })
}

export async function computeAndSaveSnapshot(params: { afterCheckinId?: number; afterQuestId?: number }): Promise<TimeDebtSnapshotRecord> {
  const [checkins, quests, settings, lastSnapshot, regimeSnapshot, goal, manualMatrix, learned] = await Promise.all([
    db.checkins.orderBy('ts').toArray(),
    db.quests.orderBy('createdAt').toArray(),
    getSettings(),
    getLastSnapshot(),
    db.regimeSnapshots.orderBy('ts').last(),
    db.goals.where('status').equals('active').last(),
    db.settings.get('influence-matrix'),
    db.learnedMatrices.orderBy('computedAt').last(),
  ])

  const latestCheckin = checkins.at(-1)
  if (!latestCheckin) {
    const empty: TimeDebtSnapshotRecord = {
      ts: Date.now(),
      dayKey: dayKeyFromTs(Date.now()),
      debts: { sleepDebt: 0, recoveryDebt: 0, focusDebt: 0, socialDebt: 0 },
      totals: { totalDebt: 0, debtIndex: 0, debtTrend: 'flat' },
      explainTop3: ['Нет данных для расчёта долга.'],
      protocol: [],
      protocolActions: [],
      effectEstimate: { deltaIndex: 0, deltaPCollapse: 0, deltaGoalScore: 0 },
      links: { checkinId: params.afterCheckinId, questId: params.afterQuestId },
    }
    const id = await db.timeDebtSnapshots.add(empty)
    return { ...empty, id }
  }

  const debts = computeDebts(buildDailySeries(checkins), quests, settings)
  const totalDebt = debts.sleepDebt + debts.recoveryDebt + debts.focusDebt + (debts.socialDebt ?? 0)
  const debtIndex = Number((100 - Math.min(100, totalDebt * 6)).toFixed(2))
  const prevTotal = lastSnapshot?.totals.totalDebt ?? totalDebt
  const debtTrend = totalDebt > prevTotal + 0.05 ? 'up' : totalDebt < prevTotal - 0.05 ? 'down' : 'flat'
  const matrix = resolveActiveMatrix('mixed', (manualMatrix?.value as never) ?? defaultInfluenceMatrix, learned?.value.weights ?? ((manualMatrix?.value as never) ?? defaultInfluenceMatrix), 0.5)
  const protocolActions = buildProtocol({
    debts,
    sirenLevel: regimeSnapshot?.sirenLevel ?? 'green',
    activeGoal: goal ?? null,
    latestCheckin,
    matrix,
  })
  const effectEstimate = protocolActions.reduce((acc, action) => ({
    deltaIndex: acc.deltaIndex + action.effect.deltaIndex,
    deltaPCollapse: acc.deltaPCollapse + action.effect.deltaPCollapse,
    deltaGoalScore: acc.deltaGoalScore + action.effect.deltaGoalScore,
  }), { deltaIndex: 0, deltaPCollapse: 0, deltaGoalScore: 0 })

  const snapshot: TimeDebtSnapshotRecord = {
    ts: Date.now(),
    dayKey: dayKeyFromTs(Date.now()),
    debts,
    totals: { totalDebt: Number(totalDebt.toFixed(2)), debtIndex, debtTrend },
    explainTop3: buildExplainTop3(debts),
    protocol: protocolActions.map((item) => item.actionId),
    protocolActions,
    effectEstimate: {
      deltaIndex: Number(effectEstimate.deltaIndex.toFixed(2)),
      deltaPCollapse: Number(effectEstimate.deltaPCollapse.toFixed(4)),
      deltaGoalScore: Number(effectEstimate.deltaGoalScore.toFixed(2)),
    },
    links: { checkinId: params.afterCheckinId, questId: params.afterQuestId },
  }

  const id = await db.timeDebtSnapshots.add(snapshot)
  return { ...snapshot, id }
}

export async function getLastSnapshot(): Promise<TimeDebtSnapshotRecord | undefined> {
  return db.timeDebtSnapshots.orderBy('ts').last()
}

export async function listSnapshots(range?: { fromTs?: number; toTs?: number; limit?: number }): Promise<TimeDebtSnapshotRecord[]> {
  const rows = await db.timeDebtSnapshots.orderBy('ts').reverse().toArray()
  return rows
    .filter((item) => (range?.fromTs ? item.ts >= range.fromTs : true) && (range?.toTs ? item.ts <= range.toTs : true))
    .slice(0, range?.limit ?? rows.length)
}
