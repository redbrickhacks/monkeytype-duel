import type { Side, StationState } from "../shared/protocol";
import type { Preferences } from "./preferences";
import { caretDuration } from "./preferences";
import type { TypingSession, TypingStats } from "./typing";

type RendererOptions = {
  root: HTMLElement;
  identity: string;
  text: string;
  label: string;
  endAt: number;
  spectator: boolean;
  mySide?: Side;
  preferences: Preferences;
  onDeadline: () => void;
};

const sides: readonly Side[] = ["L", "R"];

export class TypingRenderer {
  readonly identity: string;
  readonly text: string;
  private readonly root: HTMLElement;
  private readonly spectator: boolean;
  private readonly mySide: Side | undefined;
  private readonly onDeadline: () => void;
  private readonly letters: HTMLElement[] = [];
  private readonly words: HTMLElement[] = [];
  private readonly carets = new Map<Side | "local", HTMLElement>();
  private readonly stats = new Map<Side, HTMLElement>();
  private readonly test: HTMLElement;
  private readonly timer: HTMLElement;
  private readonly ownWpm: HTMLElement;
  private readonly viewport: HTMLElement;
  private readonly track: HTMLElement;
  private preferences: Preferences;
  private endAt: number;
  private session: TypingSession | undefined;
  private frame = 0;
  private idleTimer = 0;
  private scrollOffset = 0;
  private readonly lastCaretTops = new Map<Side | "local", number>();
  private menuOpen = false;
  private deadlineHandled = false;
  private previousTypedLength = 0;
  private remoteIndexes = new Map<Side, number>();

  constructor(options: RendererOptions) {
    this.root = options.root;
    this.identity = options.identity;
    this.text = options.text;
    this.spectator = options.spectator;
    this.mySide = options.mySide;
    this.preferences = options.preferences;
    this.endAt = options.endAt;
    this.onDeadline = options.onDeadline;

    this.root.innerHTML = `<section class="test" tabindex="0" aria-label="Typing test">
      <div class="test-top"><span class="timer">0</span><span class="test-label"></span><span class="own-wpm">0 wpm</span></div>
      <div class="words-viewport">
        <div class="words-track" id="words" aria-label="Typing text"></div>
        <div class="focus-warning" aria-hidden="true">click to focus</div>
      </div>
      <div class="live-stats" aria-label="Live duel statistics"></div>
    </section>`;
    this.test = mustElement(this.root, ".test");
    this.test.classList.toggle(
      "practice-test",
      options.identity.startsWith("practice-"),
    );
    this.timer = mustElement(this.root, ".timer");
    this.ownWpm = mustElement(this.root, ".own-wpm");
    this.viewport = mustElement(this.root, ".words-viewport");
    this.track = mustElement(this.root, ".words-track");
    mustElement(this.root, ".test-label").textContent = options.label;
    this.mountWords();
    this.mountCarets();
    this.mountStats();
    this.applyPreferences(options.preferences);

    this.test.addEventListener("pointerdown", () => this.focus());
    this.test.addEventListener("focus", () => this.updateFocusState());
    this.test.addEventListener("blur", () => this.updateFocusState());
    window.addEventListener("resize", this.onResize);
    document.fonts.ready
      .then(() => this.updatePositions(true))
      .catch(() => undefined);
    this.startClock();
    if (!this.spectator) this.focus();
  }

  attachSession(session: TypingSession): void {
    this.session = session;
    this.updateTyping(session.stats());
  }

  updateTyping(stats: TypingStats): void {
    const typed = this.session?.typed ?? [];
    const changed = typed.length !== this.previousTypedLength;
    const from = Math.min(this.previousTypedLength, typed.length);
    const to = Math.max(this.previousTypedLength, typed.length);
    for (let index = from; index <= to; index++) {
      const letter = this.letters[index];
      if (letter === undefined) continue;
      letter.classList.toggle(
        "correct",
        index < typed.length && typed[index] === this.text[index],
      );
      letter.classList.toggle(
        "incorrect",
        index < typed.length && typed[index] !== this.text[index],
      );
    }
    this.previousTypedLength = typed.length;
    this.ownWpm.textContent = `${Math.round(stats.wpm)} wpm`;
    this.ownWpm.hidden = !this.preferences.showLiveInfo || this.spectator;
    if (changed) {
      this.markTyping();
    }
    this.moveCaret("local", stats.cursorIndex);
  }

  updateRemote(stations: Partial<Record<Side, StationState>>): void {
    for (const side of sides) {
      const station = stations[side];
      const stat = this.stats.get(side);
      if (stat !== undefined) {
        const wpm = stat.querySelector<HTMLElement>("strong");
        const accuracy = stat.querySelector<HTMLElement>("small");
        if (wpm !== null) {
          wpm.textContent = String(Math.round(station?.wpm ?? 0));
        }
        if (accuracy !== null) {
          accuracy.textContent = `${(station?.accuracy ?? 100).toFixed(0)}%`;
        }
        stat.hidden = !this.preferences.showLiveInfo;
      }

      const caret = this.carets.get(side);
      if (caret === undefined) continue;
      const visible =
        station !== undefined &&
        this.preferences.showGhost &&
        (this.spectator || side !== this.mySide);
      caret.hidden = !visible;
      if (!visible || station === undefined) continue;
      this.remoteIndexes.set(side, station.cursorIndex);
      const label = caret.querySelector<HTMLElement>(".caret-label");
      if (label !== null) {
        label.textContent = `${side} ${station.profile.displayName}`;
      }
      this.moveCaret(side, station.cursorIndex);
    }
    if (this.spectator && this.remoteIndexes.size) {
      const lead = Math.max(...this.remoteIndexes.values());
      const target = this.letters[Math.min(lead, this.letters.length - 1)];
      if (target !== undefined) {
        this.adjustScroll(target);
      }
    }
  }

  applyPreferences(preferences: Preferences): void {
    this.preferences = preferences;
    this.test.dataset.caretStyle = preferences.caretStyle;
    this.test.dataset.motion = preferences.motion;
    this.test.style.setProperty(
      "--caret-duration",
      `${caretDuration(preferences)}ms`,
    );
    this.test.classList.toggle("hide-live-info", !preferences.showLiveInfo);
    this.test.classList.toggle(
      "smooth-scroll",
      preferences.smoothScrolling && preferences.motion !== "reduced",
    );
    this.ownWpm.hidden = !preferences.showLiveInfo || this.spectator;
    this.updateFocusState();
    this.updatePositions(true);
  }

  setMenuOpen(open: boolean): void {
    this.menuOpen = open;
    this.test.classList.toggle("menu-open", open);
    this.updateFocusState();
  }

  focus(): void {
    if (!this.spectator && !this.menuOpen) {
      this.test.focus({ preventScroll: true });
    }
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    window.clearTimeout(this.idleTimer);
    window.removeEventListener("resize", this.onResize);
  }

  private readonly onResize = (): void => {
    this.scrollOffset = 0;
    this.track.style.transform = "translateY(0)";
    for (const word of this.words) {
      word.classList.remove("above-scroll");
    }
    this.updatePositions(true);
  };

  private mountWords(): void {
    const words = this.text.split(" ");
    let characterIndex = 0;
    for (let wordIndex = 0; wordIndex < words.length; wordIndex++) {
      const word = document.createElement("span");
      word.className = "word";
      this.words.push(word);
      for (const character of words[wordIndex] ?? "") {
        word.append(this.makeLetter(character, characterIndex++));
      }
      if (wordIndex < words.length - 1) {
        word.append(this.makeLetter(" ", characterIndex++));
      }
      this.track.append(word);
    }
    this.track.append(this.makeLetter(" ", characterIndex, true));
  }

  private makeLetter(
    character: string,
    index: number,
    terminal = false,
  ): HTMLElement {
    const letter = document.createElement("span");
    letter.className = terminal ? "letter terminal-letter" : "letter";
    letter.dataset.index = String(index);
    letter.textContent = character === " " ? "\u00a0" : character;
    this.letters[index] = letter;
    return letter;
  }

  private mountCarets(): void {
    if (!this.spectator) this.carets.set("local", this.makeCaret("local"));
    for (const side of sides) this.carets.set(side, this.makeCaret(side));
  }

  private makeCaret(owner: Side | "local"): HTMLElement {
    const caret = document.createElement("span");
    caret.className =
      owner === "local"
        ? "typing-caret local-caret"
        : `typing-caret ghost-caret side-${owner}`;
    caret.dataset.owner = owner;
    if (owner !== "local") {
      caret.hidden = true;
      const label = document.createElement("span");
      label.className = "caret-label";
      caret.append(label);
    }
    this.track.append(caret);
    return caret;
  }

  private mountStats(): void {
    const statsRoot = mustElement<HTMLElement>(this.root, ".live-stats");
    for (const side of sides) {
      const stat = document.createElement("div");
      stat.className = "race-stat";
      stat.innerHTML = `<b>${side}</b><strong>0</strong><span>wpm</span><small>100%</small>`;
      statsRoot.append(stat);
      this.stats.set(side, stat);
    }
  }

  private startClock(): void {
    const tick = (): void => {
      const remaining = Math.max(0, this.endAt - Date.now());
      this.timer.textContent = String(Math.ceil(remaining / 1000));
      if (remaining <= 0) {
        if (!this.deadlineHandled) {
          this.deadlineHandled = true;
          this.onDeadline();
        }
        return;
      }
      this.frame = requestAnimationFrame(tick);
    };
    tick();
  }

  private markTyping(): void {
    this.test.classList.add("is-typing");
    window.clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(
      () => this.test.classList.remove("is-typing"),
      650,
    );
  }

  private moveCaret(owner: Side | "local", index: number, snap = false): void {
    const caret = this.carets.get(owner);
    const target = this.letters[Math.min(index, this.letters.length - 1)];
    if (caret === undefined || target === undefined) return;
    caret.dataset.index = String(index);

    if (owner === "local") this.adjustScroll(target);
    const targetRect = target.getBoundingClientRect();
    const x = target.offsetLeft;
    const y = target.offsetTop;
    const previousTop = this.lastCaretTops.get(owner) ?? y;
    const lineChanged = Math.abs(y - previousTop) > targetRect.height / 2;
    caret.classList.toggle("snap", snap || lineChanged);
    caret.style.setProperty("--caret-x", `${x}px`);
    caret.style.setProperty("--caret-y", `${y}px`);
    caret.style.setProperty("--letter-width", `${targetRect.width}px`);
    this.lastCaretTops.set(owner, y);
    if (snap || lineChanged) {
      requestAnimationFrame(() => caret.classList.remove("snap"));
    }
  }

  private adjustScroll(target: HTMLElement): void {
    const lineHeight =
      Number.parseFloat(getComputedStyle(this.track).lineHeight) ||
      target.getBoundingClientRect().height;
    const firstLineTop = this.letters[0]?.offsetTop ?? 0;
    const line = Math.max(
      0,
      Math.round((target.offsetTop - firstLineTop) / lineHeight),
    );
    const nextOffset = Math.max(0, (line - 1) * lineHeight);
    if (Math.abs(nextOffset - this.scrollOffset) < 1) return;
    this.scrollOffset = nextOffset;
    const firstVisibleTop = firstLineTop + Math.max(0, line - 1) * lineHeight;
    for (const word of this.words) {
      word.classList.toggle(
        "above-scroll",
        word.offsetTop < firstVisibleTop - 1,
      );
    }
    this.track.style.transform = `translateY(-${nextOffset}px)`;
  }

  private updatePositions(snap: boolean): void {
    requestAnimationFrame(() => {
      const localIndex = this.session?.typed.length ?? 0;
      if (!this.spectator) this.moveCaret("local", localIndex, snap);
      for (const side of sides) {
        const caret = this.carets.get(side);
        if (caret?.hidden === false) {
          const lastIndex = Number(caret.dataset.index ?? 0);
          this.moveCaret(side, lastIndex, snap);
        }
      }
    });
  }

  private updateFocusState(): void {
    const unfocused = !this.spectator && document.activeElement !== this.test;
    this.test.classList.toggle("unfocused", unfocused && !this.menuOpen);
  }
}

function mustElement<T extends HTMLElement>(
  root: ParentNode,
  selector: string,
): T {
  const element = root.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Missing required element: ${selector}`);
  }
  return element;
}
