export type RegimeId = 0 | 1 | 2 | 3 | 4

export interface RegimeDefinition {
  id: RegimeId
  labelRu: string
  descriptionRu: string
}

export interface RegimeDistribution {
  regimeId: RegimeId
  probability: number
}

export interface RegimeSnapshotRecord {
  id?: number
  ts: number
  dayKey: string
  regimeId: RegimeId
  regimeProbs?: number[]
  next1?: number[]
  next3?: number[]
  pCollapse: number
  sirenLevel: 'green' | 'amber' | 'red'
  explainTop3: string[]
}
