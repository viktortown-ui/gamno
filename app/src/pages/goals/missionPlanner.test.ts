import { describe, expect, it } from 'vitest'
import { buildMissionSuggestion, missionEffectRange } from './missionPlanner'

describe('missionPlanner', () => {
  it('avoids excluded templates when alternatives exist', () => {
    const first = buildMissionSuggestion({ metricId: 'focus', presetId: 'sprint', durationDays: 3, excludedTemplateIds: [], salt: 0 })
    const second = buildMissionSuggestion({ metricId: 'focus', presetId: 'sprint', durationDays: 3, excludedTemplateIds: [first.id], salt: 1 })
    expect(second.id).not.toBe(first.id)
  })


  it('steers away from conflict tags when alternatives exist', () => {
    const neutral = buildMissionSuggestion({ metricId: 'productivity', presetId: 'sprint', durationDays: 3, excludedTemplateIds: [], salt: 0 })
    const steered = buildMissionSuggestion({ metricId: 'productivity', presetId: 'sprint', durationDays: 3, excludedTemplateIds: [], avoidTags: ['energy', 'stress'], salt: 0 })
    expect(neutral.id).toBe('prod-top-1')
    expect(steered.id).not.toBe('prod-top-1')
    expect(steered.tags ?? []).not.toEqual(expect.arrayContaining(['energy', 'stress']))
  })

  it('maps effect ranges by duration and profile', () => {
    expect(missionEffectRange(1, 'small')).toEqual({ min: 1, max: 3, expected: 2 })
    expect(missionEffectRange(3, 'large')).toEqual({ min: 6, max: 10, expected: 8 })
  })
})
