import { describe, expect, it } from 'vitest'
import { buildUnifiedActionCatalog } from './catalog'

describe('action catalog', () => {
  it('has unique ids and deterministic order', () => {
    const first = buildUnifiedActionCatalog()
    const second = buildUnifiedActionCatalog()
    expect(first.length).toBeGreaterThanOrEqual(30)
    const ids = first.map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(second.map((item) => item.id))
  })
})
