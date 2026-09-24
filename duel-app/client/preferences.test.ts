import { describe, expect, it } from "vitest";
import {
  defaultPreferences,
  loadPreferences,
  PREFERENCES_KEY,
  validatePreferences,
  themes,
} from "./preferences";

describe("preferences", () => {
  it("loads the complete Monkeytype theme catalogue", () => {
    expect(Object.keys(themes)).toHaveLength(187);
    expect(themes["8008"]?.label).toBe("8008");
    expect(themes["8008"]).toMatchObject({
      bg: "#333a45",
      main: "#f44c7f",
    });
    expect(themes.serika_dark?.label).toBe("Serika Dark");
  });
  it("accepts valid values and replaces invalid fields independently", () => {
    const preferences = validatePreferences({
      ...defaultPreferences,
      theme: "dracula",
      fontSize: 9,
      showGhost: false,
    });

    expect(preferences.theme).toBe("dracula");
    expect(preferences.fontSize).toBe(defaultPreferences.fontSize);
    expect(preferences.showGhost).toBe(false);
  });

  it("falls back safely for malformed and inaccessible storage", () => {
    const malformed = {
      getItem: (key: string) => (key === PREFERENCES_KEY ? "{" : null),
    } as Storage;
    const inaccessible = {
      getItem: () => {
        throw new Error("storage denied");
      },
    } as unknown as Storage;

    expect(loadPreferences(malformed)).toEqual(defaultPreferences);
    expect(loadPreferences(inaccessible)).toEqual(defaultPreferences);
  });
});
