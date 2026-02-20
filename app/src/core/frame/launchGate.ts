export function needsLaunchOnboarding(checkinsCount: number, hasFrame: boolean): boolean {
  return checkinsCount < 3 || !hasFrame
}
