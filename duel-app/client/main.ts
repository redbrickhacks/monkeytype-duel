import "./style.css";
import type {
  ClientMessage,
  PublicProfile,
  RoomSnapshot,
  ServerMessage,
  Side,
} from "../shared/protocol";
import { TypingSession, type TypingStats } from "./typing";

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
      snapshot = message.snapshot;
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

function renderRegistration(): void {
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
  const now = Date.now() + offset;
  if (snapshot.phase === "countdown" || now < race.startAt) {
    const remaining = Math.max(1, Math.ceil((race.startAt - now) / 1000));
    view.innerHTML = `<section class="countdown"><p>get ready</p><strong>${remaining}</strong></section>`;
    frame = requestAnimationFrame(() => renderRace(spectator));
    return;
  }
  if (!spectator && (!typing || typing.text !== race.text)) {
    typing = new TypingSession(race.text, race.startAt - offset);
    finishSent = false;
    progressSequence = 0;
  }
  renderTypingView(
    spectator ? "live duel" : `station ${mySide}`,
    race.startAt + race.durationSeconds * 1000 - offset,
    spectator ? undefined : race.text,
    spectator,
  );
}

function renderTypingView(
  label: string,
  endAt: number,
  textOverride?: string,
  spectator = false,
): void {
  const text = textOverride ?? typing?.text ?? practiceText;
  const remaining = Math.max(0, (endAt - Date.now()) / 1000);
  const stats = typing?.stats() ?? emptyStats();
  view.innerHTML = `<section class="test"><div class="test-top"><span class="timer">${Math.ceil(remaining)}</span><span>${escapeHtml(label)}</span><span>${Math.round(stats.wpm)} wpm</span></div><div class="words" id="words">${renderLetters(text, spectator ? 0 : stats.cursorIndex, spectator)}</div><div class="live-stats">${raceStat("L")}${raceStat("R")}</div></section>`;
  positionGhosts();
  if (remaining <= 0 && !spectator) finishCurrent();
  else frame = requestAnimationFrame(() => updateRaceClock(endAt, spectator));
}

function updateRaceClock(endAt: number, spectator: boolean): void {
  const timer = view.querySelector<HTMLElement>(".timer");
  if (timer) {
    timer.textContent = String(
      Math.max(0, Math.ceil((endAt - Date.now()) / 1000)),
    );
  }
  if (Date.now() >= endAt) {
    if (!spectator) finishCurrent();
    else render();
  } else {
    frame = requestAnimationFrame(() => updateRaceClock(endAt, spectator));
  }
}

function finishCurrent(): void {
  if (!typing || finishSent) return;
  if (snapshot.phase === "racing") {
    finishSent = true;
    const result = typing.stats();
    if (result.correctChars > 0) send({ type: "finish", result });
  } else {
    finishSent = false;
    typing = undefined;
    send({ type: "practiceComplete" });
  }
}

function renderResults(): void {
  const sorted = [...snapshot.results].sort((a, b) => b.wpm - a.wpm);
  view.innerHTML = `<section class="results"><p class="eyebrow">race complete</p><h2>${sorted.length ? `${escapeHtml(sorted[0].profile.displayName)} wins` : "no finishers"}</h2><div class="result-grid">${["L", "R"].map((side) => resultCard(side as Side)).join("")}</div><button class="primary" id="rematchButton">ready again</button>${leaderboardMarkup()}</section>`;
  mustElement<HTMLButtonElement>(view, "#rematchButton").onclick = () =>
    send({ type: "rematch" });
}

function renderSpectator(): void {
  if (snapshot.phase === "countdown" || snapshot.phase === "racing") {
    renderRace(true);
    return;
  }
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

function renderLetters(
  text: string,
  cursor: number,
  spectator: boolean,
): string {
  const me = mySide ? snapshot.stations[mySide] : undefined;
  const typed = spectator ? [] : (typing?.typed ?? []);
  return (
    Array.from(text)
      .map((letter, index) => {
        let state = "";
        if (!spectator && index < typed.length) {
          state = typed[index] === letter ? "correct" : "incorrect";
        }
        const caret = !spectator && index === cursor ? " own-caret" : "";
        return `<span class="letter ${state}${caret}" data-index="${index}">${letter === " " ? "&nbsp;" : escapeHtml(letter)}</span>`;
      })
      .join("") +
    (!spectator && cursor >= text.length
      ? `<span class="letter own-caret">&nbsp;</span>`
      : "") +
    (me ? "" : "")
  );
}

function positionGhosts(): void {
  const container = view.querySelector<HTMLElement>("#words");
  if (!container) return;
  if (route === "station" && typing) {
    const active = container.querySelector<HTMLElement>(
      `[data-index="${typing.typed.length}"]`,
    );
    if (active) {
      container.scrollTop = Math.max(
        0,
        active.offsetTop - active.offsetHeight * 1.2,
      );
    }
  }
  for (const side of ["L", "R"] as Side[]) {
    if (side === mySide && route === "station") continue;
    const station = snapshot.stations[side];
    if (!station) continue;
    const letter = container.querySelector<HTMLElement>(
      `[data-index="${station.cursorIndex}"]`,
    );
    if (!letter) continue;
    const ghost = document.createElement("span");
    ghost.className = `ghost-caret side-${side}`;
    ghost.textContent = `${side} ${station.profile.displayName}`;
    ghost.style.left = `${letter.offsetLeft}px`;
    ghost.style.top = `${letter.offsetTop}px`;
    container.append(ghost);
  }
}

function raceStat(side: Side): string {
  const station = snapshot.stations[side];
  return `<div class="race-stat"><b>${side}</b><strong>${Math.round(station?.wpm ?? 0)}</strong><span>wpm</span><small>${(station?.accuracy ?? 100).toFixed(0)}%</small></div>`;
}
function emptyStats(): TypingStats {
  return {
    cursorIndex: 0,
    correctChars: 0,
    incorrectChars: 0,
    wpm: 0,
    raw: 0,
    accuracy: 100,
    consistency: 100,
  };
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

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    (document.activeElement as HTMLElement | null)?.blur();
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
    !typing ||
    Date.now() < typing.startedAt ||
    (snapshot.phase !== "racing" && !practiceEndAt)
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
  renderTypingView(
    snapshot.phase === "racing" ? `station ${mySide}` : "practice",
    snapshot.phase === "racing" && snapshot.race !== undefined
      ? snapshot.race.startAt - offset + snapshot.race.durationSeconds * 1000
      : practiceEndAt,
    typing.text,
  );
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

mustElement<HTMLButtonElement>(document, "#spectateButton").onclick = () => {
  route = route === "spectator" ? "station" : "spectator";
  location.hash = route === "spectator" ? "#/spectate" : "#/";
  send({ type: "hello", role: route, stationToken });
  render();
};
mustElement<HTMLButtonElement>(document, "#homeButton").onclick = () => {
  route = "station";
  location.hash = "#/";
  render();
};
mustElement<HTMLButtonElement>(document, "#themeButton").onclick = () =>
  document.documentElement.classList.toggle("light");
window.addEventListener("hashchange", () => {
  route = location.hash === "#/spectate" ? "spectator" : "station";
  render();
});
connect();
