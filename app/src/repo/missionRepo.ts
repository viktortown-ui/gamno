import type { GoalRecord, Mission, MissionStatus } from '../core/models/goal'
import { listGoals, updateGoal } from '../core/storage/repo'
import { buildProposedMission } from '../pages/goals/missionPlanner'

function byUpdatedDesc(a: Mission, b: Mission) {
  return b.updatedAt - a.updatedAt
}

export function getCurrentMission(goal: GoalRecord): Mission | undefined {
  const missions = [...(goal.missions ?? [])].sort(byUpdatedDesc)
  return missions.find((item) => item.status !== 'done') ?? missions[0]
}

export async function ensureSuggestedMission(goal: GoalRecord): Promise<Mission | undefined> {
  const missions = [...(goal.missions ?? [])].sort(byUpdatedDesc)
  const existing = missions.find((item) => item.status === 'accepted' || item.status === 'suggested' || item.status === 'snoozed')
  if (existing) return existing
  const mission = buildProposedMission(goal)
  await updateGoal(goal.id, { missions: [mission, ...missions] })
  return mission
}

export async function setMissionStatus(goal: GoalRecord, missionId: string, status: MissionStatus): Promise<void> {
  const now = Date.now()
  const missions = (goal.missions ?? []).map((item) => {
    if (item.id !== missionId) return item
    if (status === 'done') {
      return { ...item, status, updatedAt: now, doneAt: now }
    }
    return { ...item, status, updatedAt: now, doneAt: undefined }
  })
  await updateGoal(goal.id, { missions })
}

export async function completeMission(goal: GoalRecord, missionId: string): Promise<void> {
  await setMissionStatus(goal, missionId, 'done')
  const all = await listGoals()
  const updated = all.find((item) => item.id === goal.id)
  if (!updated) return
  await ensureSuggestedMission(updated)
}
