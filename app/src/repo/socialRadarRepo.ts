import { db } from '../core/storage/db'
import type { SocialRadarResult } from '../core/models/socialRadar'

export async function saveInsight(result: SocialRadarResult, windowDays: number, maxLag: number): Promise<void> {
  await db.socialInsights.add({
    computedAt: result.computedAt,
    windowDays,
    maxLag,
    resultsPayload: result,
  })
}

export async function getLastInsight(): Promise<SocialRadarResult | undefined> {
  const row = await db.socialInsights.orderBy('computedAt').last()
  return row?.resultsPayload
}

export async function clear(): Promise<void> {
  await db.socialInsights.clear()
}
