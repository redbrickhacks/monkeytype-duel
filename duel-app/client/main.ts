/// <reference types="vite/client" />

import "./style.css";
import type {
  ClientMessage,
  LeaderboardEntry,
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
const afkOverlay = mustElement<HTMLElement>(document, "#afkOverlay");
const afkCountdown = mustElement<HTMLElement>(document, "#afkCountdown");
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
let afkActive = false;
let lastActivitySentAt = 0;
applyPreferences(preferences);

function setPreferences(update: Partial<Preferences>): void {
  preferences = { ...preferences, ...update };
  savePreferences(preferences, globalThis.localStorage);
  applyPreferences(preferences);
  renderer?.applyPreferences(preferences);
  const themeButton = document.querySelector<HTMLButtonElement>("#themeButton");
  if (themeButton) {
    themeButton.textContent = themeLabel(preferences.theme).toLowerCase();
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
      const previousPhase = snapshot.phase;
      offset = message.snapshot.serverNow - Date.now();
      if (message.snapshot.race?.id !== activeRaceId) {
        activeRaceId = message.snapshot.race?.id;
        raceOffset = offset;
      }
      snapshot = message.snapshot;
      commandMenu.refresh();
      syncSide();
      renderWithLeaderboardTransition(previousPhase);
    } else if (message.type === "claimed") {
      stationToken = message.stationToken;
      mySide = message.side;
      localStorage.setItem("duelStationToken", stationToken);
      localStorage.setItem("duelSide", mySide);
      render();
    } else if (message.type === "error") {
      showToast(message.message, true);
    } else if (message.type === "control" && message.action === "refresh") {
      location.reload();
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

window.addEventListener("error", (event) => {
  send({
    type: "clientLog",
    level: "error",
    message: String(event.message || "Unhandled browser error").slice(0, 500),
  });
});
window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason as unknown;
  send({
    type: "clientLog",
    level: "error",
    message: (reason instanceof Error
      ? reason.message
      : typeof reason === "string"
        ? reason
        : "Unhandled promise rejection"
    ).slice(0, 500),
  });
});

function reportActivity(force = false): void {
  if (
    mySide === undefined ||
    stationToken === undefined ||
    stationToken === "" ||
    !isPracticeSessionActive()
  ) {
    return;
  }
  const now = Date.now();
  if (!force && now - lastActivitySentAt < 1_500) return;
  lastActivitySentAt = now;
  if (afkActive) {
    afkActive = false;
    afkOverlay.hidden = true;
    document.documentElement.classList.remove("afk-active");
  }
  send({ type: "activity" });
}

function isPracticeSessionActive(): boolean {
  return (
    screenKey.startsWith("practice-") &&
    typing !== undefined &&
    practiceEndAt > Date.now()
  );
}

function renderWithLeaderboardTransition(
  previousPhase: RoomSnapshot["phase"],
): void {
  const documentWithTransitions = document as Document & {
    startViewTransition?: (update: () => void) => void;
  };
  if (
    previousPhase !== "results" &&
    snapshot.phase === "results" &&
    typeof documentWithTransitions.startViewTransition === "function"
  ) {
    documentWithTransitions.startViewTransition(() => render());
  } else {
    render();
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
    lastActivitySentAt = Date.now();
    send({ type: "practiceStart" });
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
  view.innerHTML = `<section class="lobby"><div class="lobby-head"><p class="eyebrow">duel lobby</p><h2>${opponent ? "opponent found" : "waiting for opponent"}</h2></div>${opponent ? `<div class="duelists">${stationCard("L")}<div class="versus">vs</div>${stationCard("R")}</div>` : waitingMonkey()}<div class="lobby-actions"><button class="primary ${me?.ready ? "ready" : ""}" id="readyButton">${me?.ready ? "ready ✓" : "ready up"}</button><button class="text-action" id="releaseStation">leave station</button></div>${leaderboardMarkup()}</section>`;
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
  if (spectator && view.querySelector(".leaderboard") === null) {
    view.insertAdjacentHTML("beforeend", leaderboardMarkup());
  }
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
  view.innerHTML = `<section class="results"><p class="eyebrow">race complete</p><h2>${sorted.length ? `${escapeHtml(sorted[0].profile.displayName)} wins` : "no finishers"}</h2><div class="result-grid">${["L", "R"].map((side) => resultCard(side as Side)).join("")}</div><p class="result-reset">stations reset in <strong id="resultResetCountdown">15</strong>s</p><button class="primary" id="rematchButton">ready again</button>${leaderboardMarkup()}</section>`;
  mustElement<HTMLButtonElement>(view, "#rematchButton").onclick = () =>
    send({ type: "rematch" });
  updateResultCountdown();
}

function renderSpectator(): void {
  if (snapshot.phase === "countdown" || snapshot.phase === "racing") {
    renderRace(true);
    return;
  }
  mountScreen(`spectator-${snapshot.phase}`);
  view.innerHTML = `<section class="spectator"><p class="eyebrow">spectator mode</p><h2>${snapshot.phase === "results" ? "latest result" : "waiting for the next duel"}</h2>${snapshot.stations.L || snapshot.stations.R ? `<div class="duelists">${stationCard("L")}<div class="versus">vs</div>${stationCard("R")}</div>` : waitingMonkey()}${snapshot.phase === "results" ? `<div class="result-grid">${resultCard("L")}${resultCard("R")}</div><p class="result-reset">next players in <strong id="resultResetCountdown">15</strong>s</p>` : ""}${leaderboardMarkup()}</section>`;
  if (snapshot.phase === "results") updateResultCountdown();
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
  const entries = leaderboardEntries();
  return `<section class="leaderboard"><h3>leaderboard</h3><div class="leaderboard-head"><span>#</span><span>player</span><span>wpm</span><span>raw</span><span>acc</span></div>${entries.length ? entries.map((entry, index) => `<div class="leaderboard-row${entry.provisional ? " provisional" : ""}" style="view-transition-name: player-${entry.githubId}"><b>${entry.provisional ? "—" : index + 1}</b><span><img src="${escapeHtml(entry.avatarUrl)}" alt="">${escapeHtml(entry.displayName)}</span><strong>${entry.provisional ? "waiting" : Math.round(entry.bestWpm)}</strong><span>${entry.provisional ? "—" : Math.round(entry.bestRaw)}</span><span>${entry.provisional ? "—" : `${entry.accuracy.toFixed(1)}%`}</span></div>`).join("") : `<p class="empty-board">Register to join the grid.</p>`}</section>`;
}

type DisplayLeaderboardEntry = LeaderboardEntry & { provisional?: boolean };

function leaderboardEntries(): DisplayLeaderboardEntry[] {
  const activeProfiles = (["L", "R"] as const)
    .map((side) => snapshot.stations[side]?.profile)
    .filter((profile) => profile !== undefined);
  const showGridPositions = snapshot.phase !== "results";
  const entries: DisplayLeaderboardEntry[] = snapshot.leaderboard
    .filter(
      (entry) =>
        !showGridPositions ||
        !activeProfiles.some((profile) => profile.githubId === entry.githubId),
    )
    .map((entry) => ({ ...entry }));
  if (!showGridPositions) return entries;
  for (const side of ["L", "R"] as const) {
    const profile = snapshot.stations[side]?.profile;
    if (profile !== undefined) {
      entries.push({
        ...profile,
        bestWpm: 0,
        bestRaw: 0,
        accuracy: 100,
        races: 0,
        lastPlayedAt: 0,
        provisional: true,
      });
    }
  }
  return entries;
}

function updateResultCountdown(): void {
  const element = view.querySelector<HTMLElement>("#resultResetCountdown");
  if (element === null || snapshot.resultsResetAt === undefined) return;
  element.textContent = String(
    Math.max(
      0,
      Math.ceil((snapshot.resultsResetAt - (Date.now() + offset)) / 1_000),
    ),
  );
  frame = requestAnimationFrame(updateResultCountdown);
}

function waitingMonkey(): string {
  return `<div class="waiting-monkey" aria-label="Animated monkey typing while waiting"><div class="monkey-head"><i></i><i></i><span></span></div><div class="monkey-hands"><b></b><b></b></div><div class="monkey-keyboard"><span></span><span></span><span></span><span></span><span></span></div><p>warming up the keys…</p></div>`;
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

function themeLabel(name: string): string {
  return themes[name]?.label ?? themes.serika_dark?.label ?? "Serika Dark";
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
    active: () => preferences[key] === value,
    action: () => setPreferences({ [key]: value } as Partial<Preferences>),
  }));

function themeCommands(): Command[] {
  return Object.entries(themes).map(([name, theme]) => ({
    id: `theme-${name}`,
    name: theme.label,
    active: () => preferences.theme === name,
    theme: {
      bg: theme.bg,
      main: theme.main,
      sub: theme.sub,
      text: theme.text,
    },
    hover: () => applyPreferences({ ...preferences, theme: name }),
    unhover: () => applyPreferences(preferences),
    action: () => setPreferences({ theme: name }),
  }));
}

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
      children: themeCommands,
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
  reportActivity(afkActive);
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

window.addEventListener("pointerdown", () => reportActivity(true), {
  capture: true,
});
window.addEventListener("pointermove", () => reportActivity(), {
  capture: true,
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") reportActivity(true);
});

function updateAfkOverlay(): void {
  const station = mySide ? snapshot.stations[mySide] : undefined;
  const now = Date.now() + offset;
  const active =
    station?.afkWarningAt !== undefined &&
    station.afkResetAt !== undefined &&
    now >= station.afkWarningAt;
  afkActive = active;
  afkOverlay.hidden = !active;
  document.documentElement.classList.toggle("afk-active", active);
  if (active && station.afkResetAt !== undefined) {
    afkCountdown.textContent = String(
      Math.max(0, Math.ceil((station.afkResetAt - now) / 1_000)),
    );
  }
}

window.setInterval(updateAfkOverlay, 250);

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
  themeLabel(preferences.theme).toLowerCase();
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
