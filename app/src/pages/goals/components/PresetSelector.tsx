import type { GoalModePresetId } from '../../../core/models/goal'

interface PresetCard {
  id: GoalModePresetId
  title: string
  summary: string
}

interface PresetSelectorProps {
  presets: PresetCard[]
  activePresetId: GoalModePresetId
  onSelect: (presetId: GoalModePresetId) => void
}

export function PresetSelector({ presets, activePresetId, onSelect }: PresetSelectorProps) {
  return (
    <div className="forge-presets" role="tablist" aria-label="Режимы кузницы">
      {presets.map((preset) => (
        <button
          key={preset.id}
          type="button"
          role="tab"
          aria-selected={activePresetId === preset.id}
          className={activePresetId === preset.id ? 'forge-preset forge-preset--active' : 'forge-preset'}
          onClick={() => onSelect(preset.id)}
        >
          <strong>{preset.title}</strong>
          <span>{preset.summary}</span>
        </button>
      ))}
    </div>
  )
}
