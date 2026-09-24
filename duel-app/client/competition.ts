import type { RoomPhase } from "../shared/protocol";

export function isActiveCompetition(phase: RoomPhase): boolean {
  return phase === "countdown" || phase === "racing";
}

export function canLeaveStation(phase: RoomPhase): boolean {
  return !isActiveCompetition(phase);
}

export function canNavigateToSpectator(
  phase: RoomPhase,
  currentlySpectating: boolean,
): boolean {
  return currentlySpectating || !isActiveCompetition(phase);
}
