import { describe, expect, it } from "vitest";
import { parseClientMessage } from "./validation.js";

describe("parseClientMessage", () => {
  it("accepts valid station messages", () => {
    expect(
      parseClientMessage({ type: "claim", side: "L", githubLogin: "octocat" }),
    ).toEqual({ type: "claim", side: "L", githubLogin: "octocat" });
    expect(
      parseClientMessage({
        type: "progress",
        sequence: 1,
        cursorIndex: 5,
        wpm: 80,
        accuracy: 98,
      }),
    ).toMatchObject({ type: "progress", cursorIndex: 5 });
    expect(parseClientMessage({ type: "activity" })).toEqual({
      type: "activity",
    });
    expect(parseClientMessage({ type: "practiceStart" })).toEqual({
      type: "practiceStart",
    });
    expect(parseClientMessage({ type: "skipPractice" })).toEqual({
      type: "skipPractice",
    });
    expect(
      parseClientMessage({
        type: "clientLog",
        level: "error",
        message: "render failed",
      }),
    ).toMatchObject({ type: "clientLog", level: "error" });
  });

  it("rejects invalid sides and non-finite race values", () => {
    expect(() =>
      parseClientMessage({ type: "claim", side: "X", githubLogin: "octocat" }),
    ).toThrow("Invalid station claim");
    expect(() =>
      parseClientMessage({
        type: "progress",
        sequence: 1,
        cursorIndex: 5,
        wpm: Number.NaN,
        accuracy: 98,
      }),
    ).toThrow("Invalid progress message");
  });

  it("rejects unknown message types", () => {
    expect(() => parseClientMessage({ type: "adminReset" })).toThrow(
      "Unknown message type",
    );
  });
});
