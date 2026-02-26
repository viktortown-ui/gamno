import { hierarchy, tree } from 'd3-hierarchy'

export type BranchStrength = 'weak' | 'normal' | 'strong'

export interface YggdrasilMissionLeaf {
  id: string
  title: string
  done?: boolean
}

export interface YggdrasilBranch {
  id: string
  title: string
  direction: 'up' | 'down'
  rune: 'I' | 'II' | 'III' | 'IV' | 'V'
  strength: BranchStrength
  missions: YggdrasilMissionLeaf[]
}

interface Props {
  objective: string
  branches: YggdrasilBranch[]
  selectedBranchId: string | null
  onSelectBranch: (branchId: string) => void
  onFocusTrunk: () => void
}

interface TreeHierarchyNode {
  id: string
  kind: 'objective' | 'kr'
  title: string
  rune?: YggdrasilBranch['rune']
  strength?: BranchStrength
  direction?: 'up' | 'down'
  missions?: YggdrasilMissionLeaf[]
  children?: TreeHierarchyNode[]
}

const strengthLabel: Record<BranchStrength, string> = {
  weak: 'слабая',
  normal: 'норм',
  strong: 'сильная',
}

const runeWidth: Record<YggdrasilBranch['rune'], number> = {
  I: 2.5,
  II: 3.5,
  III: 4.5,
  IV: 5.5,
  V: 6.5,
}

function branchPath(sourceX: number, sourceY: number, targetX: number, targetY: number): string {
  const dx = targetX - sourceX
  const curve = Math.max(24, Math.abs(dx) * 0.35)
  return `M${sourceX} ${sourceY} C${sourceX + dx * 0.2} ${sourceY - curve}, ${targetX - dx * 0.2} ${targetY + curve * 0.25}, ${targetX} ${targetY}`
}

export function GoalYggdrasilTree({ objective, branches, selectedBranchId, onSelectBranch, onFocusTrunk }: Props) {
  const sceneBranches = branches.slice(0, 5)
  const treeData = hierarchy<TreeHierarchyNode>({
    id: 'root',
    kind: 'objective',
    title: objective || 'Уточните цель в Кузнице.',
    children: sceneBranches.map((branch) => ({
      id: branch.id,
      kind: 'kr',
      title: branch.title,
      rune: branch.rune,
      strength: branch.strength,
      direction: branch.direction,
      missions: branch.missions.slice(0, 3),
    })),
  })

  const layout = tree<TreeHierarchyNode>().size([280, 180]).separation((a, b) => (a.parent === b.parent ? 1.1 : 1.5))
  const root = layout(treeData)
  const rootNode = root
  const krNodes = root.children ?? []

  return (
    <div className="goal-yggdrasil">
      <div className="goal-yggdrasil__head">
        <h2>Иггдрасиль</h2>
        <button type="button" className="filter-button" onClick={onFocusTrunk}>Фокус на стволе</button>
      </div>
      <p className="goal-yggdrasil__objective"><strong>Objective:</strong> {objective || 'Уточните цель в Кузнице.'}</p>
      <div className="goal-yggdrasil__scene">
        <svg viewBox="0 0 360 320" role="img" aria-label="Сцена Иггдрасиля">
          <g transform="translate(40 12)">
            <path d={`M${rootNode.x} ${296} C${rootNode.x - 8} 270, ${rootNode.x - 3} 238, ${rootNode.x} ${rootNode.y + 62}`} className="goal-yggdrasil__trunk" />
            <path d={`M${rootNode.x} ${296} C${rootNode.x - 20} 286, ${rootNode.x - 24} 274, ${rootNode.x - 36} 268`} className="goal-yggdrasil__root" />
            <path d={`M${rootNode.x} ${296} C${rootNode.x + 20} 286, ${rootNode.x + 24} 274, ${rootNode.x + 36} 268`} className="goal-yggdrasil__root" />

            {krNodes.map((krNode) => {
              if (krNode.data.kind !== 'kr' || !krNode.data.rune || !krNode.data.strength || !krNode.data.direction) return null
              const branch = krNode.data
              const rune = branch.rune ?? 'I'
              const isSelected = selectedBranchId === branch.id
              const isDimmed = selectedBranchId !== null && !isSelected
              return (
                <g
                  key={branch.id}
                  className={`goal-yggdrasil__branch-group ${isSelected ? 'goal-yggdrasil__branch-group--selected' : ''} ${isDimmed ? 'goal-yggdrasil__branch-group--dimmed' : ''}`}
                  onClick={() => onSelectBranch(branch.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onSelectBranch(branch.id)
                    }
                  }}
                  tabIndex={0}
                  role="button"
                  aria-label={`Ветвь ${branch.title}`}
                >
                  <path
                    d={branchPath(rootNode.x, rootNode.y + 58, krNode.x, krNode.y)}
                    className={`goal-yggdrasil__branch goal-yggdrasil__branch--${branch.strength}`}
                    style={{ strokeWidth: runeWidth[rune] }}
                  />
                  <circle cx={krNode.x} cy={krNode.y} r="13" className={`goal-yggdrasil__leaf goal-yggdrasil__leaf--${branch.strength}`} />
                  <text x={krNode.x} y={krNode.y + 4} textAnchor="middle" className="goal-yggdrasil__rune">{branch.rune}</text>
                  <text x={krNode.x} y={krNode.y - 18} textAnchor="middle" className="goal-yggdrasil__label">{branch.title}</text>

                  {(branch.missions ?? []).map((mission, index) => {
                    const offsetX = branch.direction === 'up' ? -12 : 12
                    const missionX = krNode.x + offsetX + (branch.direction === 'up' ? -8 : 8) * index
                    const missionY = krNode.y + 20 + index * 9
                    return (
                      <g key={mission.id} className={`goal-yggdrasil__mission ${mission.done ? 'goal-yggdrasil__mission--done' : ''}`}>
                        <ellipse cx={missionX} cy={missionY} rx="5" ry="3.5" />
                      </g>
                    )
                  })}
                </g>
              )
            })}
          </g>
        </svg>
      </div>
      <ul className="goal-yggdrasil__branches">
        {sceneBranches.map((branch, index) => (
          <li key={branch.id} className={`panel ${selectedBranchId === branch.id ? 'goal-yggdrasil__branch-card--selected' : ''}`}>
            <strong>KR{index + 1}: {branch.title}</strong>
            <span>{branch.direction === 'up' ? '↑ Рост' : '↓ Снижение'} · Руна {branch.rune} · {strengthLabel[branch.strength]}</span>
          </li>
        ))}
      </ul>
      {sceneBranches.length === 0 ? <p>Ветви появятся после настройки KR в Кузнице.</p> : null}
      <p className="goal-yggdrasil__caption">Числовые параметры спрятаны в «Кузнице (для продвинутых)».</p>
    </div>
  )
}
