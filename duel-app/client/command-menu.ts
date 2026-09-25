// Adapted from frontend/src/ts/commandline/commandline.ts in Monkeytype.
// The interaction model and search ranking intentionally stay aligned with it.
export type Command = {
  id: string;
  name: string;
  aliases?: string[];
  hint?: string;
  disabled?: boolean;
  children?: () => Command[];
  action?: () => void;
  active?: () => boolean;
  hover?: () => void;
  unhover?: () => void;
  theme?: { bg: string; main: string; sub: string; text: string };
};

type MenuLevel = { id: string; title: string; commands: Command[] };

export class CommandMenu {
  private readonly host: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly suggestions: HTMLElement;
  private readonly commands: () => Command[];
  private readonly onChange: (open: boolean) => void;
  private stack: MenuLevel[] = [];
  private visible: Command[] = [];
  private inputValue = "";
  private activeIndex = 0;
  private mouseMode = false;
  private previousFocus: HTMLElement | null = null;
  private previewed: Command | undefined;

  constructor(commands: () => Command[], onChange: (open: boolean) => void) {
    this.commands = commands;
    this.onChange = onChange;
    this.host = document.createElement("div");
    this.host.id = "commandLine";
    this.host.className = "modalWrapper";
    this.host.setAttribute("aria-hidden", "true");
    this.host.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="Command line"><div class="command-input-row"><div class="searchicon" aria-hidden="true">${searchIcon()}</div><input class="input" role="combobox" aria-label="Search commands" aria-controls="commandSuggestions" aria-autocomplete="list" autocomplete="off" autocapitalize="off" spellcheck="false"></div><div class="suggestions" id="commandSuggestions" role="listbox"></div></div>`;
    document.body.append(this.host);
    this.input = must<HTMLInputElement>(this.host, ".input");
    this.suggestions = must(this.host, ".suggestions");

    this.input.addEventListener("input", () => {
      this.inputValue = this.input.value;
      this.mouseMode = false;
      this.activeIndex = 0;
      this.showCommands();
    });
    this.input.addEventListener("keydown", this.onKeyDown);
    this.host.addEventListener("pointerdown", (event) => {
      if (event.target === this.host) this.close();
    });
    this.host.addEventListener("mousemove", () => {
      this.mouseMode = true;
    });
    this.suggestions.addEventListener("mousemove", (event) => {
      this.mouseMode = true;
      const row = (event.target as Element | null)?.closest<HTMLElement>(
        ".command[data-index]",
      );
      if (!row) return;
      const next = Number(row.dataset.index);
      if (Number.isNaN(next) || next === this.activeIndex) return;
      this.activeIndex = next;
      this.updateActiveCommand();
    });
    this.suggestions.addEventListener("click", (event) => {
      const row = (event.target as Element | null)?.closest<HTMLElement>(
        ".command[data-index]",
      );
      if (!row) return;
      const next = Number(row.dataset.index);
      if (Number.isNaN(next)) return;
      this.activeIndex = next;
      this.updateActiveCommand();
      this.runActiveCommand();
    });
  }

  get isOpen(): boolean {
    return this.host.classList.contains("open");
  }

  open(): void {
    if (this.isOpen) return;
    this.previousFocus = document.activeElement as HTMLElement | null;
    this.stack = [{ id: "root", title: "commands", commands: this.commands() }];
    this.inputValue = "";
    this.activeIndex = 0;
    this.mouseMode = false;
    this.input.value = "";
    this.input.placeholder = "Type to search";
    this.host.classList.add("open");
    this.host.setAttribute("aria-hidden", "false");
    this.showCommands();
    this.input.focus();
    this.onChange(true);
  }

  close(): void {
    if (!this.isOpen) return;
    this.clearPreview();
    this.host.classList.remove("open", "noBackground");
    this.host.setAttribute("aria-hidden", "true");
    this.input.setAttribute("aria-expanded", "false");
    this.onChange(false);
    this.previousFocus?.focus({ preventScroll: true });
  }

  toggle(): void {
    this.isOpen ? this.close() : this.open();
  }

  refresh(): void {
    if (!this.isOpen) return;
    const root = this.commands();
    const rebuilt: MenuLevel[] = [
      { id: "root", title: "commands", commands: root },
    ];
    let commands = root;
    for (const level of this.stack.slice(1)) {
      const parent = commands.find((command) => command.id === level.id);
      const children = parent?.children?.();
      if (!parent || !children) break;
      rebuilt.push({ id: parent.id, title: parent.name, commands: children });
      commands = children;
    }
    this.stack = rebuilt;
    this.showCommands();
  }

  private current(): MenuLevel {
    const level = this.stack[this.stack.length - 1];
    if (level === undefined) throw new Error("Command menu has no root level");
    return level;
  }

  private showCommands(): void {
    const atRoot = this.stack.length === 1;
    this.visible = filterCommands(
      this.current().commands,
      this.inputValue,
      atRoot,
    );
    this.activeIndex = Math.min(
      this.activeIndex,
      Math.max(0, this.visible.length - 1),
    );
    this.input.placeholder = atRoot ? "Type to search" : this.current().title;
    this.input.setAttribute("aria-expanded", "true");
    this.suggestions.replaceChildren();

    if (this.visible.length === 0) {
      const empty = document.createElement("div");
      empty.className = "command-empty";
      empty.textContent = "no matching commands";
      this.suggestions.append(empty);
    } else {
      this.visible.forEach((command, index) => {
        const row = document.createElement("div");
        row.id = `command-${safeId(command.id)}-${index}`;
        row.className = "command";
        row.dataset.index = String(index);
        row.setAttribute("role", "option");
        row.setAttribute("aria-selected", "false");
        if (command.disabled) row.setAttribute("aria-disabled", "true");

        const icon = document.createElement("div");
        icon.className = "icon";
        icon.innerHTML = commandIcon(command);
        const display = document.createElement("div");
        display.className = "command-display";
        display.textContent = command.name;
        row.append(icon, display);

        if (command.theme) {
          row.classList.add("changeThemeCommand");
          const bubbles = document.createElement("div");
          bubbles.className = "themeBubbles";
          bubbles.style.background = command.theme.bg;
          bubbles.style.outlineColor = command.theme.bg;
          for (const color of [
            command.theme.main,
            command.theme.sub,
            command.theme.text,
          ]) {
            const bubble = document.createElement("div");
            bubble.className = "themeBubble";
            bubble.style.background = color;
            bubbles.append(bubble);
          }
          row.append(bubbles);
        }
        if (command.hint !== undefined && command.hint !== "") {
          const hint = document.createElement("small");
          hint.textContent = command.hint;
          row.append(hint);
        }
        this.suggestions.append(row);
      });
    }
    this.updateActiveCommand();
  }

  private updateActiveCommand(): void {
    this.suggestions
      .querySelectorAll<HTMLElement>(".command")
      .forEach((element, index) => {
        const active = index === this.activeIndex;
        element.classList.toggle("active", active);
        element.setAttribute("aria-selected", String(active));
      });
    const command = this.visible[this.activeIndex];
    const element =
      this.suggestions.querySelector<HTMLElement>(".command.active");
    this.input.setAttribute("aria-activedescendant", element?.id ?? "");
    if (!this.mouseMode) {
      element?.scrollIntoView({ behavior: "auto", block: "center" });
    }
    if (command !== this.previewed) {
      this.clearPreview();
      this.previewed = command;
      command?.hover?.();
    }
    this.host.classList.toggle("noBackground", command?.theme !== undefined);
  }

  private clearPreview(): void {
    this.previewed?.unhover?.();
    this.previewed = undefined;
  }

  private incrementActiveIndex(): void {
    if (this.visible.length === 0) return;
    this.activeIndex = (this.activeIndex + 1) % this.visible.length;
    this.updateActiveCommand();
  }

  private decrementActiveIndex(): void {
    if (this.visible.length === 0) return;
    this.activeIndex =
      (this.activeIndex - 1 + this.visible.length) % this.visible.length;
    this.updateActiveCommand();
  }

  private runActiveCommand(): void {
    const command = this.visible[this.activeIndex];
    if (command === undefined || command.disabled === true) return;
    const children = command.children?.();
    if (children) {
      this.clearPreview();
      this.stack.push({
        id: command.id,
        title: command.name,
        commands: children,
      });
      this.inputValue = "";
      this.input.value = "";
      this.activeIndex = 0;
      this.mouseMode = false;
      this.showCommands();
      return;
    }
    command.action?.();
    this.close();
  }

  private goBackOrHide(): void {
    if (this.inputValue !== "") {
      this.inputValue = "";
      this.input.value = "";
      this.activeIndex = 0;
      this.showCommands();
    } else if (this.stack.length > 1) {
      this.clearPreview();
      this.stack.pop();
      this.activeIndex = 0;
      this.showCommands();
    } else {
      this.close();
    }
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    event.stopPropagation();
    this.mouseMode = false;
    if (
      event.key === "ArrowUp" ||
      (event.ctrlKey && ["k", "p"].includes(event.key.toLowerCase()))
    ) {
      event.preventDefault();
      this.decrementActiveIndex();
    } else if (
      event.key === "ArrowDown" ||
      (event.ctrlKey && ["j", "n"].includes(event.key.toLowerCase()))
    ) {
      event.preventDefault();
      this.incrementActiveIndex();
    } else if (event.key === "Tab") {
      event.preventDefault();
      event.shiftKey
        ? this.decrementActiveIndex()
        : this.incrementActiveIndex();
    } else if (event.key === "Enter") {
      event.preventDefault();
      this.runActiveCommand();
    } else if (event.key === "Escape") {
      event.preventDefault();
      this.goBackOrHide();
    }
  };
}

export function filterCommands(
  commands: Command[],
  queryValue: string,
  nested = true,
): Command[] {
  const query = queryValue.replace(/^>/i, "").toLowerCase().trim();
  if (query === "") return commands;
  const source = nested ? flatten(commands) : commands;
  const inputWords = query.split(/\s+/);
  const matches = source.map((command) => commandMatch(command, inputWords));
  const maxStrength = Math.max(...matches.map((match) => match.strength));
  let minimumCount = inputWords.length;
  while (
    minimumCount > 0 &&
    !matches.some((match) => match.count >= minimumCount)
  ) {
    minimumCount -= 1;
  }
  minimumCount = Math.max(1, minimumCount);
  return source.filter((_, index) => {
    const match = matches[index];
    return (
      match !== undefined &&
      match.count >= minimumCount &&
      match.strength >= maxStrength
    );
  });
}

function commandMatch(
  command: Command,
  inputWords: string[],
): { count: number; strength: number } {
  const words = [command.name, ...(command.aliases ?? [])]
    .join(" ")
    .toLowerCase()
    .split(/\s+/);
  const usedWords = new Set<number>();
  const usedInputs = new Set<number>();
  let strength = 0;
  for (const [inputIndex, input] of inputWords.entries()) {
    for (const [wordIndex, word] of words.entries()) {
      if (
        word.startsWith(input) &&
        !usedWords.has(wordIndex) &&
        !usedInputs.has(inputIndex)
      ) {
        usedWords.add(wordIndex);
        usedInputs.add(inputIndex);
        strength += input.length;
        break;
      }
    }
  }
  return { count: usedWords.size, strength };
}

function flatten(commands: Command[], prefix = ""): Command[] {
  return commands.flatMap((command) => {
    const path = prefix ? `${prefix} › ${command.name}` : command.name;
    const children = command.children?.();
    if (children) return flatten(children, path);
    return [{ ...command, name: path }];
  });
}

function commandIcon(command: Command): string {
  if (command.disabled) return lockIcon();
  if (command.children) return chevronIcon();
  if (command.active?.()) return checkIcon();
  return "";
}

function searchIcon(): string {
  return '<svg viewBox="0 0 24 24"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/></svg>';
}

function chevronIcon(): string {
  return '<svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg>';
}

function checkIcon(): string {
  return '<svg viewBox="0 0 24 24"><path d="m4 12 5 5L20 6"/></svg>';
}

function lockIcon(): string {
  return '<svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>';
}

function safeId(value: string): string {
  return value.replace(/[^a-z0-9_-]/gi, "-");
}

function must<T extends HTMLElement>(root: ParentNode, selector: string): T {
  const value = root.querySelector<T>(selector);
  if (!value) throw new Error(`Missing ${selector}`);
  return value;
}
