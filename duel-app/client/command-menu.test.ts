import { describe, expect, it } from "vitest";
import { filterCommands, type Command } from "./command-menu";
import { canLeaveStation, canNavigateToSpectator } from "./competition";

describe("command search", () => {
  const commands: Command[] = [
    {
      id: "theme",
      name: "theme",
      children: () => [{ id: "dracula", name: "Dracula" }],
    },
    {
      id: "caret",
      name: "caret style",
      aliases: ["cursor"],
      action: () => undefined,
    },
  ];

  it("finds nested options and aliases from the root", () => {
    expect(
      filterCommands(commands, "dracula").map((item) => item.name),
    ).toEqual(["theme › Dracula"]);
    expect(filterCommands(commands, "cursor").map((item) => item.id)).toEqual([
      "caret",
    ]);
  });

  it("uses Monkeytype's word-prefix matching and multi-word ranking", () => {
    expect(filterCommands(commands, "th dr").map((item) => item.name)).toEqual([
      "theme › Dracula",
    ]);
    expect(filterCommands(commands, "car st").map((item) => item.id)).toEqual([
      "caret",
    ]);
    expect(filterCommands(commands, "rac")).toEqual([]);
  });

  it("keeps the grouped command list until the user searches", () => {
    expect(filterCommands(commands, "").map((item) => item.id)).toEqual([
      "theme",
      "caret",
    ]);
  });
});

describe("competition actions", () => {
  it.each(["countdown", "racing"] as const)(
    "locks station exits during %s",
    (phase) => {
      expect(canLeaveStation(phase)).toBe(false);
      expect(canNavigateToSpectator(phase, false)).toBe(false);
    },
  );

  it("allows non-race navigation and an existing spectator route", () => {
    expect(canLeaveStation("lobby")).toBe(true);
    expect(canNavigateToSpectator("results", false)).toBe(true);
    expect(canNavigateToSpectator("racing", true)).toBe(true);
  });

  it("locks a registered station to its station flow", () => {
    expect(canNavigateToSpectator("registration", false, true)).toBe(false);
    expect(canNavigateToSpectator("lobby", false, true)).toBe(false);
  });
});
