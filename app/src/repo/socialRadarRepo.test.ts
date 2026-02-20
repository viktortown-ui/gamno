import { beforeEach, describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'

;(globalThis as unknown as { self: typeof globalThis }).self = globalThis

describe('social radar persistence', () => {
  beforeEach(async () => {
    const { clearAllData } = await import('../core/storage/repo')
    await clearAllData()
  })

  it('roundtrip для people/events/insights', async () => {
    const { createPerson, listPeople } = await import('./peopleRepo')
    const { addEvent, listByRange } = await import('./eventsRepo')
    const { saveInsight, getLastInsight, clear } = await import('./socialRadarRepo')

    const person = await createPerson({ nameAlias: 'Контакт А', notes: 'заметка' })
    await addEvent({ ts: Date.parse('2025-01-02T00:00:00.000Z'), type: 'встреча', intensity: 3, valence: 1, personId: person.id })

    const people = await listPeople()
    expect(people[0].nameAlias).toBe('Контакт А')

    const events = await listByRange('2025-01-01', '2025-01-03')
    expect(events).toHaveLength(1)
    expect(events[0].personId).toBe(person.id)

    await saveInsight({
      computedAt: Date.now(),
      windowDays: 56,
      maxLag: 7,
      disclaimerRu: 'Показана предиктивная связь, не доказательство причинности.',
      influencesByMetric: { stress: [], energy: [], mood: [], index: [] },
    }, 56, 7)

    const last = await getLastInsight()
    expect(last?.windowDays).toBe(56)

    await clear()
    expect(await getLastInsight()).toBeUndefined()
  })
})
