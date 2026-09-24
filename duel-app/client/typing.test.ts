import { describe, expect, it } from "vitest";
import { TypingSession } from "./typing";

describe("TypingSession", () => {
  it("counts correct and incorrect characters", () => {
    const session = new TypingSession("test", 0);
    session.input("t", 1_000);
    session.input("x", 1_000);
    const stats = session.stats(60_000);
    expect(stats.correctChars).toBe(1);
    expect(stats.incorrectChars).toBe(1);
    expect(stats.accuracy).toBe(50);
  });

  it("supports backspace and calculates standard five-character WPM", () => {
    const session = new TypingSession("hello world", 0);
    for (const key of "hello") session.input(key, 60_000);
    expect(session.stats(60_000).wpm).toBe(1);
    session.input("Backspace", 60_000);
    expect(session.stats(60_000).cursorIndex).toBe(4);
  });
});
