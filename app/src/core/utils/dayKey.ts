export function dayKeyFromTs(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10)
}

export function dayKeyToTs(dayKey: string): number {
  return Date.parse(`${dayKey}T00:00:00.000Z`)
}

export function createDenseDayKeys(startDayKey: string, endDayKey: string): string[] {
  const start = dayKeyToTs(startDayKey)
  const end = dayKeyToTs(endDayKey)
  const out: string[] = []
  for (let current = start; current <= end; current += 24 * 60 * 60 * 1000) {
    out.push(dayKeyFromTs(current))
  }
  return out
}
