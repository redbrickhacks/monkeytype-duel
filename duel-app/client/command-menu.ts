export type Command = {
  id: string;
  name: string;
  aliases?: string[];
  hint?: string;
  disabled?: boolean;
  children?: () => Command[];
  action?: () => void;
};

export class CommandMenu {
  private readonly host: HTMLElement;
  private readonly commands: () => Command[];
  private readonly onChange: (open: boolean) => void;
  private stack: { title: string; commands: Command[] }[] = [];
  private query = "";
  private selected = 0;
  private previousFocus: HTMLElement | null = null;

  constructor(commands: () => Command[], onChange: (open: boolean) => void) {
    this.commands = commands;
    this.onChange = onChange;
    this.host = document.createElement("div");
    this.host.id = "commandMenu";
    document.body.append(this.host);
    this.host.addEventListener("keydown", this.onKeyDown);
    this.host.addEventListener("pointerdown", (event) => {
      if (event.target === this.host) this.close();
    });
  }

  get isOpen(): boolean {
    return this.host.classList.contains("open");
  }

  open(): void {
    if (this.isOpen) return;
    this.previousFocus = document.activeElement as HTMLElement | null;
    this.stack = [{ title: "commands", commands: this.commands() }];
    this.query = "";
    this.selected = 0;
    this.host.className = "open";
    this.render();
    this.onChange(true);
  }

  close(): void {
    if (!this.isOpen) return;
    this.host.className = "";
    this.host.replaceChildren();
    this.onChange(false);
    this.previousFocus?.focus({ preventScroll: true });
  }

  toggle(): void {
    this.isOpen ? this.close() : this.open();
  }

  refresh(): void {
    if (!this.isOpen) return;
    const title = this.current().title;
    const root = this.commands();
    if (this.stack.length === 1) {
      this.stack = [{ title: "commands", commands: root }];
    } else {
      const category = root.find((command) => command.name === title);
      this.stack = [
        { title: "commands", commands: root },
        { title, commands: category?.children?.() ?? [] },
      ];
    }
    this.render();
  }

  private current(): { title: string; commands: Command[] } {
    return this.stack[this.stack.length - 1] as {
      title: string;
      commands: Command[];
    };
  }

  private filtered(): Command[] {
    return filterCommands(
      this.current().commands,
      this.query,
      this.stack.length === 1,
    );
  }

  private render(): void {
    const previousInput =
      this.host.querySelector<HTMLInputElement>(".command-search");
    const selectionStart = previousInput?.selectionStart ?? this.query.length;
    const selectionEnd = previousInput?.selectionEnd ?? selectionStart;
    const commands = this.filtered();
    this.selected = Math.min(this.selected, Math.max(0, commands.length - 1));
    const panel = document.createElement("div");
    panel.className = "command-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", this.current().title);
    panel.innerHTML = `<div class="command-search-row"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8" fill="none" stroke="currentColor" stroke-width="2"/><path d="m16 16 5 5" stroke="currentColor" stroke-width="2"/></svg><input class="command-search" role="combobox" aria-label="Search commands" aria-controls="commandOptions" aria-autocomplete="list" autocomplete="off" spellcheck="false"><kbd>esc</kbd></div><div class="command-breadcrumb"></div><div class="command-options" id="commandOptions" role="listbox"></div>`;
    const input = must<HTMLInputElement>(panel, ".command-search");
    input.value = this.query;
    input.setAttribute("aria-expanded", "true");
    input.setAttribute("aria-haspopup", "listbox");
    input.setAttribute(
      "aria-activedescendant",
      commands[this.selected] !== undefined
        ? `command-${commands[this.selected]?.id}`
        : "",
    );
    input.addEventListener("input", () => {
      this.query = input.value;
      this.selected = 0;
      this.render();
    });
    const breadcrumb = must(panel, ".command-breadcrumb");
    breadcrumb.textContent = this.stack.map((entry) => entry.title).join(" / ");
    if (this.stack.length > 1) {
      breadcrumb.setAttribute("role", "button");
      breadcrumb.tabIndex = 0;
      breadcrumb.title = "Back";
      breadcrumb.addEventListener("click", () => {
        this.stack.pop();
        this.query = "";
        this.selected = 0;
        this.render();
      });
    }
    const options = must(panel, ".command-options");
    if (!commands.length) {
      options.innerHTML = `<p class="command-empty">no matching commands</p>`;
    } else {
      commands.forEach((command, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.id = `command-${command.id}`;
        button.className = `command-option${index === this.selected ? " active" : ""}`;
        button.setAttribute("role", "option");
        button.setAttribute("aria-selected", String(index === this.selected));
        button.disabled = command.disabled ?? false;
        button.innerHTML = `<span>${escapeHtml(command.name)}</span><small>${escapeHtml(command.hint ?? (command.children ? "›" : "enter"))}</small>`;
        button.addEventListener("pointermove", () => {
          if (this.selected !== index) {
            this.selected = index;
            this.updateSelection();
          }
        });
        button.addEventListener("click", () => this.choose(command));
        options.append(button);
      });
    }
    this.host.replaceChildren(panel);
    input.focus();
    input.setSelectionRange(selectionStart, selectionEnd);
  }

  private updateSelection(): void {
    const commands = this.filtered();
    this.host
      .querySelectorAll<HTMLElement>(".command-option")
      .forEach((element, index) => {
        element.classList.toggle("active", index === this.selected);
        element.setAttribute("aria-selected", String(index === this.selected));
      });
    const input = this.host.querySelector<HTMLInputElement>(".command-search");
    input?.setAttribute(
      "aria-activedescendant",
      commands[this.selected] !== undefined
        ? `command-${commands[this.selected]?.id}`
        : "",
    );
    this.host
      .querySelector(".command-option.active")
      ?.scrollIntoView({ block: "nearest" });
  }

  private choose(command: Command): void {
    if (command.disabled) return;
    const children = command.children?.();
    if (children) {
      this.stack.push({ title: command.name, commands: children });
      this.query = "";
      this.selected = 0;
      this.render();
      return;
    }
    command.action?.();
    this.close();
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    event.stopPropagation();
    if (
      event.target instanceof HTMLElement &&
      event.target.classList.contains("command-breadcrumb") &&
      (event.key === "Enter" || event.key === " ")
    ) {
      event.preventDefault();
      this.stack.pop();
      this.query = "";
      this.selected = 0;
      this.render();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      if (this.stack.length > 1) {
        this.stack.pop();
        this.query = "";
        this.selected = 0;
        this.render();
      } else {
        this.close();
      }
      return;
    }
    const commands = this.filtered();
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!commands.length) return;
      this.selected =
        (this.selected +
          (event.key === "ArrowDown" ? 1 : -1) +
          commands.length) %
        commands.length;
      this.updateSelection();
    } else if (event.key === "Enter") {
      event.preventDefault();
      const command = commands[this.selected];
      if (command !== undefined) {
        this.choose(command);
      }
    } else if (event.key === "Tab") {
      event.preventDefault();
    } else if (
      event.key === "Backspace" &&
      !this.query &&
      this.stack.length > 1
    ) {
      event.preventDefault();
      this.stack.pop();
      this.selected = 0;
      this.render();
    }
  };
}

export function filterCommands(
  commands: Command[],
  queryValue: string,
  nested = true,
): Command[] {
  const query = queryValue.trim().toLowerCase();
  if (!query) {
    return commands;
  }
  const source = nested ? flatten(commands) : commands;
  return source.filter((command) =>
    [command.name, ...(command.aliases ?? [])].some((value) =>
      value.toLowerCase().includes(query),
    ),
  );
}

function flatten(commands: Command[], prefix = ""): Command[] {
  return commands.flatMap((command) => {
    const path = prefix ? `${prefix} › ${command.name}` : command.name;
    const children = command.children?.();
    if (children) return flatten(children, path);
    return [{ ...command, name: path }];
  });
}

function must<T extends HTMLElement>(root: ParentNode, selector: string): T {
  const value = root.querySelector<T>(selector);
  if (!value) throw new Error(`Missing ${selector}`);
  return value;
}

function escapeHtml(value: string): string {
  const node = document.createElement("span");
  node.textContent = value;
  return node.innerHTML;
}
