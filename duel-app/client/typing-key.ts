import type { TypingAction } from "./typing";

export type TypingKeyEvent = Pick<
  KeyboardEvent,
  "key" | "ctrlKey" | "altKey" | "metaKey"
>;

export function typingActionFromKey(
  event: TypingKeyEvent,
): TypingAction | null {
  if (event.key === "Backspace") {
    return event.ctrlKey || event.altKey || event.metaKey
      ? "DeleteWord"
      : "Backspace";
  }
  if (
    event.ctrlKey ||
    event.altKey ||
    event.metaKey ||
    event.key.length !== 1
  ) {
    return null;
  }
  return event.key;
}
