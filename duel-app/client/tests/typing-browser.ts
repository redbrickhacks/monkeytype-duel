import { defaultPreferences } from "../preferences";
import { typingActionFromKey } from "../typing-key";
import { TypingRenderer } from "../typing-renderer";
import { TypingSession } from "../typing";
import type { StationState } from "../../shared/protocol";

const result = mustElement<HTMLElement>("#result");
const fixture = mustElement<HTMLElement>("#fixture");
const checks: string[] = [];

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
  checks.push(`✓ ${message}`);
}

function type(session: TypingSession, input: string): void {
  for (const key of input) session.input(key, 30_000);
}

function render(session: TypingSession, identity: string): TypingRenderer {
  const root = document.createElement("div");
  fixture.append(root);
  const renderer = new TypingRenderer({
    root,
    identity,
    text: session.text,
    label: "browser regression",
    endAt: Date.now() + 60_000,
    spectator: false,
    preferences: { ...defaultPreferences, focusBlur: false },
    onDeadline: () => undefined,
  });
  renderer.attachSession(session);
  return renderer;
}

try {
  const omission = new TypingSession("the quick brown", 0);
  type(omission, "th quick");
  const omissionRenderer = render(omission, "omission");
  assert(
    omission.wordStates()[1]?.input === "quick",
    "space realigns input after an omitted letter",
  );
  assert(
    fixture.querySelectorAll(".word:nth-child(1) .missed").length === 1,
    "the omitted letter is marked only in its own word",
  );
  assert(
    fixture.querySelectorAll(".word:nth-child(2) .correct").length === 5,
    "the following word renders as correct",
  );
  omissionRenderer.dispose();

  fixture.replaceChildren();
  const insertion = new TypingSession("the quick brown", 0);
  type(insertion, "thee quick");
  const insertionRenderer = render(insertion, "insertion");
  assert(
    fixture.querySelectorAll(".letter.extra").length === 1,
    "an inserted letter renders as one extra letter",
  );
  assert(
    fixture.querySelectorAll(".word:nth-child(2) .correct").length === 5,
    "an insertion does not shift the following word",
  );
  insertionRenderer.dispose();

  fixture.replaceChildren();
  const telemetrySession = new TypingSession("the quick brown", 0);
  type(telemetrySession, "the");
  const telemetryRenderer = render(telemetrySession, "telemetry");
  const originalRect = HTMLElement.prototype.getBoundingClientRect;
  let layoutReads = 0;
  HTMLElement.prototype.getBoundingClientRect = function () {
    layoutReads++;
    const rect = originalRect.call(this) as DOMRect;
    return rect;
  };
  telemetryRenderer.updateTyping(telemetrySession.stats(30_000));
  assert(
    layoutReads === 0,
    "an unchanged local cursor does not trigger layout measurement",
  );

  const remote: StationState = {
    side: "R",
    profile: {
      githubId: 1,
      login: "opponent",
      displayName: "Opponent",
      avatarUrl: "",
    },
    practiceCount: 2,
    ready: true,
    connected: true,
    cursorIndex: 4,
    wpm: 100,
    rawWpm: 105,
    accuracy: 98,
  };
  telemetryRenderer.updateRemote({ R: remote });
  layoutReads = 0;
  telemetryRenderer.updateRemote({ R: { ...remote, wpm: 101 } });
  assert(
    layoutReads === 0,
    "telemetry-only updates do not remeasure an unchanged ghost cursor",
  );
  HTMLElement.prototype.getBoundingClientRect = originalRect;
  telemetryRenderer.dispose();

  const shortcut = typingActionFromKey(
    new KeyboardEvent("keydown", { key: "Backspace", ctrlKey: true }),
  );
  assert(shortcut === "DeleteWord", "Ctrl+Backspace maps to delete-word");

  document.body.dataset.result = "pass";
  result.textContent = checks.join("\n");
} catch (error) {
  document.body.dataset.result = "fail";
  result.textContent =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  throw error;
}

function mustElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) throw new Error(`Missing ${selector}`);
  return element;
}
