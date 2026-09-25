import type { RoomPhase } from "../shared/protocol";

export function isActiveCompetition(phase: RoomPhase): boolean {
  return phase === "countdown" || phase === "racing";
}

export function canLeaveStation(phase: RoomPhase): boolean {
  return !isActiveCompetition(phase) && phase !== "results";
}

export function canNavigateToSpectator(
  phase: RoomPhase,
  currentlySpectating: boolean,
  hasStation = false,
): boolean {
  return currentlySpectating || (!hasStation && !isActiveCompetition(phase));
}
