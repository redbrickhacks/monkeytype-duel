import { monkeytypeThemes } from "./themes.generated";

export const PREFERENCES_KEY = "monkeytypeDuelPreferences";
export const PREFERENCES_VERSION = 1;

type ThemeDefinition = {
  label: string;
  bg: string;
  main: string;
  caret: string;
  sub: string;
  subAlt: string;
  text: string;
  error: string;
  errorExtra: string;
  scheme: "dark" | "light";
};

export const themes: Record<string, ThemeDefinition> = Object.fromEntries(
  Object.entries(monkeytypeThemes)
    .map(([name, theme]): [string, ThemeDefinition] => [
      name,
      { ...theme, scheme: isLight(theme.bg) ? "light" : "dark" },
    ])
    .sort(([left], [right]) => left.localeCompare(right)),
);

export type ThemeName = string;
export type FontSize = 1 | 1.25 | 1.5 | 2;
export type CaretStyle = "line" | "block" | "outline" | "underline";
export type SmoothCaret = "off" | "fast" | "medium" | "slow";
export type MotionPreference = "system" | "reduced";

export type Preferences = {
  version: typeof PREFERENCES_VERSION;
  theme: ThemeName;
  fontSize: FontSize;
  caretStyle: CaretStyle;
  smoothCaret: SmoothCaret;
  smoothScrolling: boolean;
  showLiveInfo: boolean;
  showGhost: boolean;
  focusBlur: boolean;
  quietMode: boolean;
  motion: MotionPreference;
};

export const defaultPreferences: Preferences = {
  version: PREFERENCES_VERSION,
  theme: "serika_dark",
  fontSize: 1.5,
  caretStyle: "line",
  smoothCaret: "medium",
  smoothScrolling: true,
  showLiveInfo: true,
  showGhost: true,
  focusBlur: true,
  quietMode: true,
  motion: "system",
};

const fontSizes: readonly FontSize[] = [1, 1.25, 1.5, 2];
const caretStyles: readonly CaretStyle[] = [
  "line",
  "block",
  "outline",
  "underline",
];
const smoothCarets: readonly SmoothCaret[] = ["off", "fast", "medium", "slow"];
const motionPreferences: readonly MotionPreference[] = ["system", "reduced"];

export function validatePreferences(value: unknown): Preferences {
  if (!isRecord(value) || value.version !== PREFERENCES_VERSION) {
    return { ...defaultPreferences };
  }

  return {
    version: PREFERENCES_VERSION,
    theme:
      typeof value.theme === "string" && Object.hasOwn(themes, value.theme)
        ? value.theme
        : defaultPreferences.theme,
    fontSize: isMember(fontSizes, value.fontSize)
      ? value.fontSize
      : defaultPreferences.fontSize,
    caretStyle: isMember(caretStyles, value.caretStyle)
      ? value.caretStyle
      : defaultPreferences.caretStyle,
    smoothCaret: isMember(smoothCarets, value.smoothCaret)
      ? value.smoothCaret
      : defaultPreferences.smoothCaret,
    smoothScrolling:
      typeof value.smoothScrolling === "boolean"
        ? value.smoothScrolling
        : defaultPreferences.smoothScrolling,
    showLiveInfo:
      typeof value.showLiveInfo === "boolean"
        ? value.showLiveInfo
        : defaultPreferences.showLiveInfo,
    showGhost:
      typeof value.showGhost === "boolean"
        ? value.showGhost
        : defaultPreferences.showGhost,
    focusBlur:
      typeof value.focusBlur === "boolean"
        ? value.focusBlur
        : defaultPreferences.focusBlur,
    quietMode:
      typeof value.quietMode === "boolean"
        ? value.quietMode
        : defaultPreferences.quietMode,
    motion: isMember(motionPreferences, value.motion)
      ? value.motion
      : defaultPreferences.motion,
  };
}

export function loadPreferences(storage: Storage | undefined): Preferences {
  if (storage === undefined) return { ...defaultPreferences };
  try {
    const stored = storage.getItem(PREFERENCES_KEY);
    return stored === null
      ? { ...defaultPreferences }
      : validatePreferences(JSON.parse(stored));
  } catch {
    return { ...defaultPreferences };
  }
}

export function savePreferences(
  preferences: Preferences,
  storage: Storage | undefined,
): void {
  if (storage === undefined) return;
  try {
    storage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    // Preferences are optional when storage is unavailable.
  }
}

export function applyPreferences(preferences: Preferences): void {
  const root = document.documentElement;
  const theme = themes[preferences.theme] ?? themes.serika_dark;
  if (theme === undefined) return;
  root.dataset.theme = preferences.theme;
  root.dataset.motion = preferences.motion;
  root.style.setProperty("--bg", theme.bg);
  root.style.setProperty("--main", theme.main);
  root.style.setProperty("--caret", theme.caret);
  root.style.setProperty("--sub", theme.sub);
  root.style.setProperty("--sub-alt", theme.subAlt);
  root.style.setProperty("--text", theme.text);
  root.style.setProperty("--error", theme.error);
  root.style.setProperty("--error-extra", theme.errorExtra);
  root.style.setProperty("--typing-size", `${preferences.fontSize}rem`);
  root.style.colorScheme = theme.scheme;
  root.classList.toggle("quiet-mode", preferences.quietMode);
  root.classList.toggle("focus-blur", preferences.focusBlur);
  const meta = document.querySelector<HTMLMetaElement>(
    'meta[name="theme-color"]',
  );
  meta?.setAttribute("content", theme.bg);
}

function isLight(color: string): boolean {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(color);
  if (!match) return false;
  const [, red = "00", green = "00", blue = "00"] = match;
  return (
    (Number.parseInt(red, 16) * 299 +
      Number.parseInt(green, 16) * 587 +
      Number.parseInt(blue, 16) * 114) /
      1000 >
    160
  );
}

export function caretDuration(preferences: Preferences): number {
  if (preferences.motion === "reduced") return 0;
  if (preferences.smoothCaret === "fast") return 85;
  if (preferences.smoothCaret === "medium") return 100;
  if (preferences.smoothCaret === "slow") return 150;
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMember<T>(values: readonly T[], value: unknown): value is T {
  return values.includes(value as T);
}
