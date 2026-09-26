import { describe, expect, it } from "vitest";
import { createTypingText } from "./text.js";

describe("createTypingText", () => {
  it("uses the supplied corpus and requested word count", () => {
    const values = [0, 0.5, 0.999];
    let index = 0;
    expect(
      createTypingText(
        ["first", "middle", "last"],
        3,
        () => values[index++] ?? 0,
      ),
    ).toBe("first middle last");
  });

  it("handles an empty corpus", () => {
    expect(createTypingText([], 120)).toBe("");
  });
});
