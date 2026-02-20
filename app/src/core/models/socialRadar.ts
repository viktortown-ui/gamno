export interface PersonRecord {
  id?: number
  nameAlias: string
  notes?: string
  createdAt: number
  updatedAt: number
}

export interface SocialEventRecord {
  id?: number
  ts: number
  dayKey: string
  type: string
  intensity: number
  valence: number
  durationMin?: number
  personId?: number
  tags?: string[]
  note?: string
  createdAt: number
}

export interface SocialInfluencePoint {
  lag: number
  value: number
}

export interface SocialInfluence {
  key: string
  sourceType: 'eventType' | 'person'
  lag: number
  sign: 'positive' | 'negative'
  strength: number
  stability: number
  confidence: 'high' | 'med' | 'low'
  effectByLag: SocialInfluencePoint[]
  evidence: string[]
}

export interface SocialRadarResult {
  computedAt: number
  windowDays: number
  maxLag: number
  disclaimerRu: string
  influencesByMetric: Record<string, SocialInfluence[]>
}

export interface SocialInsightRecord {
  id?: number
  computedAt: number
  windowDays: number
  maxLag: number
  resultsPayload: SocialRadarResult
}
