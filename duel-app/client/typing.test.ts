import { describe, expect, it } from "vitest";
import { typingActionFromKey } from "./typing-key";
import { TypingSession } from "./typing";

function type(session: TypingSession, value: string, now = 60_000): void {
  for (const key of value) session.input(key, now);
}

describe("TypingSession", () => {
  it("contains an omitted letter to its word after space", () => {
    const session = new TypingSession("the quick brown", 0);
    type(session, "th quick");
    const states = session.wordStates();
    expect(states[0]).toMatchObject({ input: "th", committed: true });
    expect(states[1]).toMatchObject({ input: "quick", committed: false });
    expect(session.stats(60_000).correctChars).toBe(5);
    expect(session.stats(60_000).wpm).toBe(1);
  });

  it("contains an extra letter to its word after space", () => {
    const session = new TypingSession("the quick brown", 0);
    type(session, "thee quick");
    const states = session.wordStates();
    expect(states[0]).toMatchObject({ input: "thee", committed: true });
    expect(states[1]).toMatchObject({ input: "quick", committed: false });
    expect(session.stats(60_000).correctChars).toBe(5);
    expect(session.stats(60_000).wpm).toBe(1);
  });

  it("contains a substitution to its word after space", () => {
    const session = new TypingSession("the quick brown", 0);
    type(session, "txe quick");
    expect(session.wordStates()[1]).toMatchObject({ input: "quick" });
    expect(session.stats(60_000).correctChars).toBe(5);
  });

  it("supports backspace and standard five-character WPM", () => {
    const session = new TypingSession("hello world", 0);
    type(session, "hello");
    expect(session.stats(60_000).wpm).toBe(1);
    session.input("Backspace", 60_000);
    expect(session.stats(60_000).cursorIndex).toBe(4);
  });

  it("clears the current word for platform word-delete shortcuts", () => {
    const session = new TypingSession("hello world", 0);
    type(session, "helx");
    const action = typingActionFromKey({
      key: "Backspace",
      ctrlKey: true,
      altKey: false,
      metaKey: false,
    });
    expect(action).toBe("DeleteWord");
    if (action !== null) session.input(action, 60_000);
    expect(session.wordStates()[0]?.input).toBe("");
    expect(session.stats(60_000).cursorIndex).toBe(0);
  });

  it.each([
    { ctrlKey: true, altKey: false, metaKey: false },
    { ctrlKey: false, altKey: true, metaKey: false },
    { ctrlKey: false, altKey: false, metaKey: true },
  ])("maps Ctrl, Option, and Command Backspace to delete-word", (modifiers) => {
    expect(typingActionFromKey({ key: "Backspace", ...modifiers })).toBe(
      "DeleteWord",
    );
  });
});
