export interface CheckinValues {
  energy: number
  focus: number
  mood: number
  stress: number
  sleepHours: number
  social: number
  productivity: number
  health: number
  cashFlow: number
}

export interface CheckinRecord extends CheckinValues {
  id?: number
  ts: number
}
