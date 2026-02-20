import { computeIndexSeries, computeVolatility } from '../engines/analytics/compute'
import type { CheckinRecord } from '../models/checkin'
import type { QuestRecord } from '../models/quest'
import type { CoreStateSnapshot } from '../engines/stateEngine'
import type { RegimeSnapshotRecord } from '../models/regime'
import { buildRegimeSeriesFromCheckins, explainRegime, getTransitionMatrix, predictNext, REGIMES } from './model'
import { assessCollapseRisk, buildDisarmProtocol, type CollapseAction } from '../collapse/model'
import { dayKeyFromTs } from '../utils/dayKey'

export interface RegimeLayerState {
  snapshot: RegimeSnapshotRecord
  collapseActions: CollapseAction[]
  nextLikelyRegime: { regimeId: number; probability: number }
}

export function computeRegimeLayer(
  checkinsDesc: CheckinRecord[],
  coreSnapshot: CoreStateSnapshot,
  activeQuest?: QuestRecord,
  ts = Date.now(),
): RegimeLayerState {
  const asc = [...checkinsDesc].reverse()
  const dayIndexes = computeIndexSeries(checkinsDesc)
  const volatility = computeVolatility(checkinsDesc, 'energy', 14) * 50
  const regimeSeries = buildRegimeSeriesFromCheckins(asc, dayIndexes, volatility)
  const regimeId = regimeSeries.at(-1) ?? 0

  const latest = checkinsDesc[0]
  const previousDayIndex = dayIndexes.length > 1 ? dayIndexes[dayIndexes.length - 2] : undefined
  const explainTop3 = explainRegime({
    dayIndex: dayIndexes.at(-1) ?? coreSnapshot.index * 10,
    prevDayIndex: previousDayIndex,
    volatility,
    stress: latest?.stress ?? 5,
    sleepHours: latest?.sleepHours ?? 7,
    energy: latest?.energy ?? 5,
    mood: latest?.mood ?? 5,
  }, regimeId)

  const matrix = getTransitionMatrix(regimeSeries)
  const next1 = predictNext(regimeId, matrix, 1)
  const next3 = predictNext(regimeId, matrix, 3)
  const collapse = assessCollapseRisk(coreSnapshot, latest)
  const collapseActions = buildDisarmProtocol(latest, collapse, activeQuest)

  const nextLikelyRegime = [...next1].sort((a, b) => b.probability - a.probability)[0] ?? { regimeId, probability: 1 }

  const snapshot: RegimeSnapshotRecord = {
    ts,
    dayKey: dayKeyFromTs(ts),
    regimeId,
    regimeProbs: REGIMES.map((regime) => Number((regime.id === regimeId ? 1 : 0).toFixed(4))),
    next1: next1.map((item) => Number(item.probability.toFixed(4))),
    next3: next3.map((item) => Number(item.probability.toFixed(4))),
    pCollapse: Number(collapse.pCollapse.toFixed(4)),
    sirenLevel: collapse.sirenLevel,
    explainTop3,
  }

  return { snapshot, collapseActions, nextLikelyRegime }
}
