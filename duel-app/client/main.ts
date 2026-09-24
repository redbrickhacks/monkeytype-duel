/// <reference types="vite/client" />

import "./style.css";
import type {
  ClientMessage,
  PublicProfile,
  RoomSnapshot,
  ServerMessage,
  Side,
} from "../shared/protocol";
import { TypingSession } from "./typing";
import { CommandMenu, type Command } from "./command-menu";
import {
  applyPreferences,
  defaultPreferences,
  loadPreferences,
  savePreferences,
  themes,
  type Preferences,
} from "./preferences";
import { TypingRenderer } from "./typing-renderer";
import {
  canLeaveStation,
  canNavigateToSpectator,
  isActiveCompetition,
} from "./competition";

const apiUrl =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ??
  location.origin;
const wsUrl = apiUrl.replace(/^http/, "ws") + "/ws";
const practiceSeconds = Number(import.meta.env.VITE_PRACTICE_SECONDS ?? 30);
const view = mustElement<HTMLElement>(document, "#view");
const toast = mustElement<HTMLElement>(document, "#toast");
const connection = mustElement<HTMLElement>(document, "#connectionStatus");
let socket: WebSocket;
let snapshot: RoomSnapshot = {
  phase: "registration",
  stations: {},
  results: [],
  leaderboard: [],
  serverNow: Date.now(),
};
let stationToken = localStorage.getItem("duelStationToken") ?? undefined;
let mySide: Side | undefined =
  (localStorage.getItem("duelSide") as Side | null) ?? undefined;
let route: "station" | "spectator" =
  location.hash === "#/spectate" ? "spectator" : "station";
let typing: TypingSession | undefined;
let practiceText = "";
let practiceEndAt = 0;
let finishSent = false;
let progressSequence = 0;
let frame = 0;
let tabArmedUntil = 0;
let offset = 0;
let raceOffset = 0;
let activeRaceId: string | undefined;
let renderer: TypingRenderer | undefined;
let typingIdentity = "";
let screenKey = "";
let preferences = loadPreferences(globalThis.localStorage);
applyPreferences(preferences);

function setPreferences(update: Partial<Preferences>): void {
  preferences = { ...preferences, ...update };
  savePreferences(preferences, globalThis.localStorage);
  applyPreferences(preferences);
  renderer?.applyPreferences(preferences);
  const themeButton = document.querySelector<HTMLButtonElement>("#themeButton");
  if (themeButton) {
    themeButton.textContent = themes[preferences.theme].label.toLowerCase();
  }
}

function connect(): void {
  connection.textContent = "connecting";
  connection.className = "connection pending";
  socket = new WebSocket(wsUrl);
  socket.addEventListener("open", () => {
    connection.textContent = "connected";
    connection.className = "connection online";
    send({
      type: "hello",
      role: route,
      stationToken: route === "station" ? stationToken : undefined,
    });
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as ServerMessage;
    if (message.type === "snapshot") {
      offset = message.snapshot.serverNow - Date.now();
      if (message.snapshot.race?.id !== activeRaceId) {
        activeRaceId = message.snapshot.race?.id;
        raceOffset = offset;
      }
      snapshot = message.snapshot;
      commandMenu.refresh();
      syncSide();
      render();
    } else if (message.type === "claimed") {
      stationToken = message.stationToken;
      mySide = message.side;
      localStorage.setItem("duelStationToken", stationToken);
      localStorage.setItem("duelSide", mySide);
      render();
    } else if (message.type === "error") {
      showToast(message.message, true);
    }
  });
  socket.addEventListener("close", () => {
    connection.textContent = "offline";
    connection.className = "connection";
    window.setTimeout(connect, 1500);
  });
}

function send(message: ClientMessage): void {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}
function syncSide(): void {
  if (
    mySide !== undefined &&
    stationToken !== undefined &&
    !snapshot.stations[mySide]
  ) {
    localStorage.removeItem("duelStationToken");
    localStorage.removeItem("duelSide");
    stationToken = undefined;
    mySide = undefined;
  }
}

function render(): void {
  cancelAnimationFrame(frame);
  if (route === "spectator") {
    renderSpectator();
    return;
  }
  const me = mySide ? snapshot.stations[mySide] : undefined;
  if (!me) {
    renderRegistration();
    return;
  }
  if (
    me.practiceCount < 2 &&
    snapshot.phase !== "countdown" &&
    snapshot.phase !== "racing"
  ) {
    renderPractice(me.practiceCount);
    return;
  }
  if (snapshot.phase === "countdown" || snapshot.phase === "racing") {
    renderRace(false);
    return;
  }
  if (snapshot.phase === "results") {
    renderResults();
    return;
  }
  renderLobby();
}

function mountScreen(key: string): void {
  if (screenKey === key) return;
  renderer?.dispose();
  renderer = undefined;
  screenKey = key;
  view.replaceChildren();
}

function renderRegistration(): void {
  if (screenKey === "registration") {
    view
      .querySelectorAll<HTMLButtonElement>("[data-side]")
      .forEach((button) => {
        const occupied =
          snapshot.stations[button.dataset.side as Side] !== undefined;
        button.classList.toggle("taken", occupied);
        const small = button.querySelector("small");
        if (small) {
          small.textContent = occupied
            ? "occupied"
            : button.dataset.side === "L"
              ? "left"
              : "right";
        }
      });
    return;
  }
  mountScreen("registration");
  view.innerHTML = `<section class="center-stage registration">
    <p class="eyebrow">event station</p><h2>choose your side</h2>
    <div class="side-picker"><button data-side="L" class="side ${snapshot.stations.L ? "taken" : ""}">L<small>${snapshot.stations.L ? "occupied" : "left"}</small></button><div class="versus">vs</div><button data-side="R" class="side ${snapshot.stations.R ? "taken" : ""}">R<small>${snapshot.stations.R ? "occupied" : "right"}</small></button></div>
    <form id="githubForm"><label for="githubLogin">GitHub username</label><div class="profile-input"><span>@</span><input id="githubLogin" autocomplete="off" spellcheck="false" placeholder="octocat" required><button type="submit">find profile</button></div></form>
    <div id="profilePreview"></div><p class="hint">Public profile lookup only — no GitHub sign-in.</p>
  </section>`;
  let selectedSide: Side | undefined;
  view.querySelectorAll<HTMLButtonElement>("[data-side]").forEach(
    (button) =>
      (button.onclick = () => {
        if (button.classList.contains("taken")) return;
        selectedSide = button.dataset.side as Side;
        view
          .querySelectorAll("[data-side]")
          .forEach((item) =>
            item.classList.toggle("selected", item === button),
          );
      }),
  );
  mustElement<HTMLFormElement>(view, "#githubForm").onsubmit = async (
    event,
  ) => {
    event.preventDefault();
    const side = selectedSide;
    if (side === undefined) {
      showToast("Choose L or R first.", true);
      return;
    }
    const input = mustElement<HTMLInputElement>(view, "#githubLogin");
    input.disabled = true;
    try {
      const response = await fetch(
        `${apiUrl}/api/profile/${encodeURIComponent(input.value.trim())}`,
      );
      const data = (await response.json()) as PublicProfile & {
        error?: string;
      };
      if (!response.ok) throw new Error(data.error ?? "Profile lookup failed.");
      mustElement<HTMLElement>(view, "#profilePreview").innerHTML =
        `<div class="profile-card"><img src="${escapeHtml(data.avatarUrl)}" alt=""><div><strong>${escapeHtml(data.displayName)}</strong><span>@${escapeHtml(data.login)}</span></div><button id="confirmProfile">use this profile</button></div>`;
      mustElement<HTMLButtonElement>(view, "#confirmProfile").onclick = () =>
        send({ type: "claim", side, githubLogin: data.login });
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Profile lookup failed.",
        true,
      );
    } finally {
      input.disabled = false;
    }
  };
}

function renderPractice(count: number): void {
  if (typing && practiceEndAt > Date.now()) {
    renderTypingView(`practice ${count + 1} of 2`, practiceEndAt, undefined);
    return;
  }
  typing = undefined;
  mountScreen(`practice-start-${count}`);
  view.innerHTML = `<section class="center-stage"><p class="eyebrow">station ${mySide}</p><h2>practice ${count + 1} of 2</h2><p class="subtle">A private 30 second warm-up. Your opponent cannot see this result.</p><button class="primary" id="startPractice">start practice</button><button class="text-action" id="releaseStation">change station</button></section>`;
  mustElement<HTMLButtonElement>(view, "#startPractice").onclick = () => {
    practiceText = makePracticeText();
    practiceEndAt = Date.now() + practiceSeconds * 1_000;
    typing = new TypingSession(practiceText, Date.now());
    renderTypingView(`practice ${count + 1} of 2`, practiceEndAt, undefined);
  };
  mustElement<HTMLButtonElement>(view, "#releaseStation").onclick = () =>
    send({ type: "release" });
}

function renderLobby(): void {
  const me = mySide ? snapshot.stations[mySide] : undefined;
  const opponentSide: Side = mySide === "L" ? "R" : "L";
  const opponent = snapshot.stations[opponentSide];
  mountScreen("lobby");
  view.innerHTML = `<section class="lobby"><div class="lobby-head"><p class="eyebrow">duel lobby</p><h2>${opponent ? "opponent found" : "waiting for opponent"}</h2></div><div class="duelists">${stationCard("L")}<div class="versus">vs</div>${stationCard("R")}</div><div class="lobby-actions"><button class="primary ${me?.ready ? "ready" : ""}" id="readyButton">${me?.ready ? "ready ✓" : "ready up"}</button><button class="text-action" id="releaseStation">leave station</button></div></section>`;
  mustElement<HTMLButtonElement>(view, "#readyButton").onclick = () =>
    send({ type: "ready", ready: !me?.ready });
  mustElement<HTMLButtonElement>(view, "#releaseStation").onclick = () =>
    send({ type: "release" });
}

function renderRace(spectator: boolean): void {
  const race = snapshot.race;
  if (!race) {
    render();
    return;
  }
  const now = Date.now() + raceOffset;
  if (snapshot.phase === "countdown" || now < race.startAt) {
    const remaining = Math.max(1, Math.ceil((race.startAt - now) / 1000));
    mountScreen(`countdown-${race.id}`);
    view.innerHTML = `<section class="countdown"><p>get ready</p><strong>${remaining}</strong></section>`;
    frame = requestAnimationFrame(() => renderRace(spectator));
    return;
  }
  if (!spectator && (!typing || typingIdentity !== race.id)) {
    typing = new TypingSession(race.text, race.startAt - raceOffset);
    typingIdentity = race.id;
    finishSent = false;
    progressSequence = 0;
  }
  renderTypingView(
    spectator ? "live duel" : `station ${mySide}`,
    race.startAt + race.durationSeconds * 1000 - raceOffset,
    race.text,
    spectator,
    `${spectator ? "spectator" : "race"}-${race.id}`,
  );
}

function renderTypingView(
  label: string,
  endAt: number,
  textOverride?: string,
  spectator = false,
  identity = `practice-${practiceEndAt}`,
): void {
  const text = textOverride ?? typing?.text ?? practiceText;
  if (renderer?.identity !== identity) {
    mountScreen(identity);
    renderer = new TypingRenderer({
      root: view,
      identity,
      text,
      label,
      endAt,
      spectator,
      mySide,
      preferences,
      onDeadline: spectator ? () => undefined : finishCurrent,
    });
    if (typing && !spectator) renderer.attachSession(typing);
    renderer.setMenuOpen(commandMenu.isOpen);
  }
  if (typing && !spectator) renderer?.updateTyping(typing.stats());
  renderer?.updateRemote(
    identity.startsWith("practice-") ? {} : snapshot.stations,
  );
}

function finishCurrent(): void {
  if (!typing || finishSent) return;
  if (screenKey.startsWith("race-") && snapshot.phase === "racing") {
    finishSent = true;
    const result = typing.stats();
    if (result.correctChars > 0) send({ type: "finish", result });
  } else if (screenKey.startsWith("practice-")) {
    finishSent = false;
    typing = undefined;
    send({ type: "practiceComplete" });
  }
}

function renderResults(): void {
  const sorted = [...snapshot.results].sort((a, b) => b.wpm - a.wpm);
  mountScreen("results");
  view.innerHTML = `<section class="results"><p class="eyebrow">race complete</p><h2>${sorted.length ? `${escapeHtml(sorted[0].profile.displayName)} wins` : "no finishers"}</h2><div class="result-grid">${["L", "R"].map((side) => resultCard(side as Side)).join("")}</div><button class="primary" id="rematchButton">ready again</button>${leaderboardMarkup()}</section>`;
  mustElement<HTMLButtonElement>(view, "#rematchButton").onclick = () =>
    send({ type: "rematch" });
}

function renderSpectator(): void {
  if (snapshot.phase === "countdown" || snapshot.phase === "racing") {
    renderRace(true);
    return;
  }
  mountScreen(`spectator-${snapshot.phase}`);
  view.innerHTML = `<section class="spectator"><p class="eyebrow">spectator mode</p><h2>${snapshot.phase === "results" ? "latest result" : "waiting for the next duel"}</h2><div class="duelists">${stationCard("L")}<div class="versus">vs</div>${stationCard("R")}</div>${snapshot.phase === "results" ? `<div class="result-grid">${resultCard("L")}${resultCard("R")}</div>` : ""}${leaderboardMarkup()}</section>`;
}

function stationCard(side: Side): string {
  const station = snapshot.stations[side];
  if (!station) {
    return `<article class="station-card empty"><b>${side}</b><span>open station</span></article>`;
  }
  return `<article class="station-card"><b>${side}</b><img src="${escapeHtml(station.profile.avatarUrl)}" alt=""><strong>${escapeHtml(station.profile.displayName)}</strong><span>@${escapeHtml(station.profile.login)}</span><small>${station.ready ? "ready" : station.connected ? "connected" : "reconnecting"}</small></article>`;
}

function resultCard(side: Side): string {
  const result = snapshot.results.find((item) => item.side === side);
  if (!result) {
    return `<article class="result-card"><span>station ${side}</span><strong>dnf</strong></article>`;
  }
  return `<article class="result-card"><span>station ${side} · ${escapeHtml(result.profile.displayName)}</span><strong>${Math.round(result.wpm)}</strong><small>wpm</small><dl><div><dt>acc</dt><dd>${result.accuracy.toFixed(1)}%</dd></div><div><dt>raw</dt><dd>${Math.round(result.raw)}</dd></div><div><dt>consistency</dt><dd>${Math.round(result.consistency)}%</dd></div></dl></article>`;
}

function leaderboardMarkup(): string {
  return `<section class="leaderboard"><h3>leaderboard</h3><div class="leaderboard-head"><span>#</span><span>player</span><span>wpm</span><span>acc</span></div>${snapshot.leaderboard.length ? snapshot.leaderboard.map((entry, index) => `<div class="leaderboard-row"><b>${index + 1}</b><span><img src="${escapeHtml(entry.avatarUrl)}" alt="">${escapeHtml(entry.displayName)}</span><strong>${Math.round(entry.bestWpm)}</strong><span>${entry.accuracy.toFixed(1)}%</span></div>`).join("") : `<p class="empty-board">Complete a duel to set the first score.</p>`}</section>`;
}

function makePracticeText(): string {
  const bank =
    "the of to and a in is it you that for on are with this from have be at one word type quick light world find new work part place made live where after back only round good every think help line turn same move right want air play small end home read hand large add land here must high follow change light kind need build head stand page found school learn cover food sun between state keep never last city tree start story".split(
      " ",
    );
  return Array.from(
    { length: 120 },
    () => bank[Math.floor(Math.random() * bank.length)],
  ).join(" ");
}
function showToast(message: string, error = false): void {
  toast.textContent = message;
  toast.className = error ? "show error" : "show";
  window.setTimeout(() => (toast.className = ""), 3500);
}
function escapeHtml(value: string): string {
  const entities: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  };
  return value.replace(/[&<>'"]/g, (char) => entities[char] ?? char);
}

function mustElement<T extends Element>(
  root: Document | Element,
  selector: string,
): T {
  const element = root.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Missing required element: ${selector}`);
  }
  return element;
}

const choiceCommands = <K extends keyof Preferences>(
  key: K,
  values: readonly Preferences[K][],
  label: (value: Preferences[K]) => string = String,
): Command[] =>
  values.map((value) => ({
    id: `${String(key)}-${String(value)}`,
    name: label(value),
    hint: preferences[key] === value ? "✓" : "",
    action: () => setPreferences({ [key]: value } as Partial<Preferences>),
  }));

function preferenceToggle(
  key: keyof Pick<
    Preferences,
    "smoothScrolling" | "showLiveInfo" | "showGhost" | "focusBlur" | "quietMode"
  >,
): Command[] {
  return choiceCommands(key, [true, false], (value) => (value ? "on" : "off"));
}

function commandInventory(): Command[] {
  const activeRace = isActiveCompetition(snapshot.phase);
  const me = mySide ? snapshot.stations[mySide] : undefined;
  return [
    {
      id: "theme",
      name: "theme",
      aliases: ["serika dracula nord terminal light"],
      children: () =>
        choiceCommands(
          "theme",
          Object.keys(themes) as (keyof typeof themes)[],
          (value) => themes[value].label,
        ),
    },
    {
      id: "font",
      name: "font size",
      aliases: ["text size"],
      children: () =>
        choiceCommands(
          "fontSize",
          [1, 1.25, 1.5, 2] as const,
          (value) => `${value}rem`,
        ),
    },
    {
      id: "caret",
      name: "caret style",
      aliases: ["line block outline underline"],
      children: () =>
        choiceCommands("caretStyle", [
          "line",
          "block",
          "outline",
          "underline",
        ] as const),
    },
    {
      id: "smooth",
      name: "smooth caret",
      aliases: ["off fast medium slow"],
      children: () =>
        choiceCommands("smoothCaret", [
          "off",
          "fast",
          "medium",
          "slow",
        ] as const),
    },
    {
      id: "scroll",
      name: "smooth scrolling",
      children: () => preferenceToggle("smoothScrolling"),
    },
    {
      id: "live",
      name: "live information",
      aliases: ["wpm accuracy"],
      children: () => preferenceToggle("showLiveInfo"),
    },
    {
      id: "ghost",
      name: "opponent ghost",
      aliases: ["caret labels"],
      children: () => preferenceToggle("showGhost"),
    },
    {
      id: "focus",
      name: "focus blur",
      children: () => preferenceToggle("focusBlur"),
    },
    {
      id: "quiet",
      name: "quiet interface",
      children: () => preferenceToggle("quietMode"),
    },
    {
      id: "motion",
      name: "motion",
      aliases: ["reduced accessibility"],
      children: () => choiceCommands("motion", ["system", "reduced"] as const),
    },
    {
      id: "station",
      name: "station",
      children: () => [
        {
          id: "ready",
          name: me?.ready ? "unready" : "ready up",
          disabled: snapshot.phase !== "lobby" || !me,
          action: () => {
            const current = mySide ? snapshot.stations[mySide] : undefined;
            if (snapshot.phase === "lobby" && current) {
              send({ type: "ready", ready: !current.ready });
            }
          },
        },
        {
          id: "leave",
          name: "leave / change station",
          disabled: activeRace || !me,
          action: () => {
            if (
              canLeaveStation(snapshot.phase) &&
              mySide &&
              snapshot.stations[mySide]
            ) {
              send({ type: "release" });
            }
          },
        },
        {
          id: "rematch",
          name: "ready again",
          disabled: snapshot.phase !== "results",
          action: () => {
            if (snapshot.phase === "results") send({ type: "rematch" });
          },
        },
      ],
    },
    {
      id: "navigation",
      name: "navigation",
      children: () => [
        {
          id: "spectate",
          name: "leaderboard / spectate",
          disabled: activeRace && route === "station",
          action: () => navigate("spectator"),
        },
        {
          id: "home",
          name: "return to station",
          action: () => navigate("station"),
        },
      ],
    },
    {
      id: "rules",
      name: "competition rules",
      aliases: ["help shortcuts locked"],
      action: () =>
        showToast(
          "Fixed text and timer. Escape opens settings; Tab + Enter rematches only on results.",
        ),
    },
    {
      id: "defaults",
      name: "restore visual defaults",
      aliases: ["reset preferences"],
      action: () => setPreferences({ ...defaultPreferences }),
    },
  ];
}

const commandMenu = new CommandMenu(commandInventory, (open) => {
  renderer?.setMenuOpen(open);
  document.querySelector("#app")?.toggleAttribute("inert", open);
  if (!open) renderer?.focus();
});

function navigate(next: "station" | "spectator"): void {
  if (next === route) {
    return;
  }
  if (
    next === "spectator" &&
    !canNavigateToSpectator(snapshot.phase, route === "spectator")
  ) {
    return;
  }
  route = next;
  location.hash = next === "spectator" ? "#/spectate" : "#/";
  send({
    type: "hello",
    role: route,
    stationToken: route === "station" ? stationToken : undefined,
  });
  screenKey = "";
  render();
}

window.addEventListener("keydown", (event) => {
  if (
    (event.ctrlKey || event.metaKey) &&
    event.shiftKey &&
    event.key.toLowerCase() === "p"
  ) {
    event.preventDefault();
    commandMenu.toggle();
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    commandMenu.toggle();
    return;
  }
  if (event.key === "Tab") {
    tabArmedUntil = Date.now() + 1200;
    return;
  }
  if (
    event.key === "Enter" &&
    Date.now() < tabArmedUntil &&
    snapshot.phase === "results"
  ) {
    event.preventDefault();
    send({ type: "rematch" });
    return;
  }
  if (
    commandMenu.isOpen ||
    event.isComposing ||
    isEditableTarget(event.target) ||
    document.activeElement !== view.querySelector(".test") ||
    !typing ||
    Date.now() < typing.startedAt ||
    (snapshot.phase !== "racing" && !screenKey.startsWith("practice-")) ||
    Date.now() >=
      (snapshot.phase === "racing" && snapshot.race
        ? snapshot.race.startAt +
          snapshot.race.durationSeconds * 1000 -
          raceOffset
        : practiceEndAt)
  ) {
    return;
  }
  if (
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    (event.key.length !== 1 && event.key !== "Backspace")
  ) {
    return;
  }
  event.preventDefault();
  const stats = typing.input(event.key);
  renderer?.updateTyping(stats);
  if (snapshot.phase === "racing" && ++progressSequence % 2 === 0) {
    send({
      type: "progress",
      sequence: progressSequence,
      cursorIndex: stats.cursorIndex,
      wpm: stats.wpm,
      accuracy: stats.accuracy,
    });
  }
});

window.addEventListener("paste", (event) => {
  if (renderer && document.activeElement === view.querySelector(".test")) {
    event.preventDefault();
  }
});

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

mustElement<HTMLButtonElement>(document, "#spectateButton").onclick = () => {
  navigate(route === "spectator" ? "station" : "spectator");
};
mustElement<HTMLButtonElement>(document, "#homeButton").onclick = () => {
  navigate("station");
};
mustElement<HTMLButtonElement>(document, "#themeButton").onclick = () =>
  commandMenu.open();
mustElement<HTMLButtonElement>(document, "#themeButton").textContent =
  themes[preferences.theme].label.toLowerCase();
window.addEventListener("hashchange", () => {
  const requested = location.hash === "#/spectate" ? "spectator" : "station";
  if (requested === route) {
    return;
  }
  if (
    requested === "spectator" &&
    route === "station" &&
    isActiveCompetition(snapshot.phase)
  ) {
    history.replaceState(null, "", "#/");
    return;
  }
  navigate(requested);
});
connect();
