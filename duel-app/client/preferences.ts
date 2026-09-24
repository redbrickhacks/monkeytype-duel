export const PREFERENCES_KEY = "monkeytypeDuelPreferences";
export const PREFERENCES_VERSION = 1;

export const themes = {
  serika_dark: {
    label: "Serika Dark",
    bg: "#323437",
    main: "#e2b714",
    caret: "#e2b714",
    sub: "#646669",
    subAlt: "#2c2e31",
    text: "#d1d0c5",
    error: "#ca4754",
    errorExtra: "#7e2a33",
    scheme: "dark",
  },
  serika: {
    label: "Serika",
    bg: "#e1e1e3",
    main: "#e2b714",
    caret: "#e2b714",
    sub: "#aaaeb3",
    subAlt: "#d1d3d8",
    text: "#323437",
    error: "#da3333",
    errorExtra: "#791717",
    scheme: "light",
  },
  dracula: {
    label: "Dracula",
    bg: "#282a36",
    main: "#bd93f9",
    caret: "#bd93f9",
    sub: "#6272a4",
    subAlt: "#20222c",
    text: "#f8f8f2",
    error: "#ff5555",
    errorExtra: "#f1fa8c",
    scheme: "dark",
  },
  nord: {
    label: "Nord",
    bg: "#242933",
    main: "#88c0d0",
    caret: "#eceff4",
    sub: "#929aaa",
    subAlt: "#2e3440",
    text: "#d8dee9",
    error: "#bf616a",
    errorExtra: "#793e44",
    scheme: "dark",
  },
  terminal: {
    label: "Terminal",
    bg: "#191a1b",
    main: "#79a617",
    caret: "#79a617",
    sub: "#48494b",
    subAlt: "#141516",
    text: "#e7eae0",
    error: "#a61717",
    errorExtra: "#731010",
    scheme: "dark",
  },
} as const;

export type ThemeName = keyof typeof themes;
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
    theme: isMember(Object.keys(themes) as ThemeName[], value.theme)
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
  const theme = themes[preferences.theme];
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
