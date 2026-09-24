import type { ClientMessage } from "../shared/protocol.js";

export function parseClientMessage(value: unknown): ClientMessage {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new Error("Invalid message.");
  }

  switch (value.type) {
    case "hello":
      if (
        (value.role !== "station" && value.role !== "spectator") ||
        (value.stationToken !== undefined &&
          (typeof value.stationToken !== "string" ||
            value.stationToken.length > 128))
      ) {
        throw new Error("Invalid hello message.");
      }
      return value as ClientMessage;
    case "claim":
      if (
        (value.side !== "L" && value.side !== "R") ||
        typeof value.githubLogin !== "string" ||
        value.githubLogin.length > 39
      ) {
        throw new Error("Invalid station claim.");
      }
      return value as ClientMessage;
    case "practiceComplete":
    case "release":
    case "rematch":
      return value as ClientMessage;
    case "ready":
      if (typeof value.ready !== "boolean") {
        throw new Error("Invalid ready message.");
      }
      return value as ClientMessage;
    case "progress":
      if (
        !areFiniteNumbers(value, ["sequence", "cursorIndex", "wpm", "accuracy"])
      ) {
        throw new Error("Invalid progress message.");
      }
      return value as ClientMessage;
    case "finish":
      if (
        !isRecord(value.result) ||
        !areFiniteNumbers(value.result, [
          "wpm",
          "raw",
          "accuracy",
          "consistency",
          "correctChars",
          "incorrectChars",
        ])
      ) {
        throw new Error("Invalid finish message.");
      }
      return value as ClientMessage;
    default:
      throw new Error("Unknown message type.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function areFiniteNumbers(
  value: Record<string, unknown>,
  keys: string[],
): boolean {
  return keys.every(
    (key) => typeof value[key] === "number" && Number.isFinite(value[key]),
  );
}
