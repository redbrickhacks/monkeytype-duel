import { randomBytes, randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import type {
  ClientMessage,
  PublicProfile,
  RaceDefinition,
  RaceResult,
  RoomSnapshot,
  ServerMessage,
  Side,
  StationState,
} from "../shared/protocol.js";
import type { DuelDatabase } from "./database.js";
import { logEvent } from "./logger.js";

type Client = {
  socket: WebSocket;
  role: "station" | "spectator";
  side?: Side;
  token?: string;
};
type Station = {
  token: string;
  socket?: WebSocket;
  lastSequence: number;
  lastActivityAt: number;
  afkWarned: boolean;
  practiceActive: boolean;
} & StationState;

const AFK_WARNING_MS = 10_000;
const AFK_RESET_MS = 20_000;
const RESULTS_RESET_MS = 15_000;

export class DuelRoom {
  private readonly clients = new Set<Client>();
  private readonly stations = new Map<Side, Station>();
  private race?: RaceDefinition;
  private results: RaceResult[] = [];
  private phase: RoomSnapshot["phase"] = "registration";
  private countdownTimer?: NodeJS.Timeout;
  private raceTimer?: NodeJS.Timeout;
  private resultsTimer?: NodeJS.Timeout;
  private resultsResetAt?: number;
  private readonly housekeepingTimer: NodeJS.Timeout;

  constructor(
    private readonly database: DuelDatabase,
    private readonly words: string[],
    private readonly durationSeconds = 30,
  ) {
    this.housekeepingTimer = setInterval(() => this.checkAfk(), 500);
    this.housekeepingTimer.unref();
  }

  addClient(socket: WebSocket): Client {
    const client: Client = { socket, role: "spectator" };
    this.clients.add(client);
    this.send(client, { type: "snapshot", snapshot: this.snapshot() });
    return client;
  }

  removeClient(client: Client): void {
    this.clients.delete(client);
    if (!client.side) return;
    const station = this.stations.get(client.side);
    if (station && station.token === client.token) {
      if (
        this.phase !== "countdown" &&
        this.phase !== "racing" &&
        this.phase !== "results"
      ) {
        this.release(client, "session ended on refresh or disconnect");
        return;
      }
      station.connected = false;
      station.socket = undefined;
      station.practiceActive = false;
      station.afkWarned = false;
      logEvent("warn", client.side, "station disconnected");
      this.broadcast();
    }
  }

  attach(client: Client, role: "station" | "spectator", token?: string): void {
    client.role = role;
    if (role === "spectator") {
      logEvent("info", "leaderboard", "spectator display connected");
      this.send(client, { type: "snapshot", snapshot: this.snapshot() });
      return;
    }
    if (token === undefined || token === "") {
      this.send(client, { type: "snapshot", snapshot: this.snapshot() });
      return;
    }
    const entry = [...this.stations.entries()].find(
      ([, station]) => station.token === token,
    );
    if (!entry) {
      this.send(client, {
        type: "error",
        message: "This station session expired. Register again.",
      });
      return;
    }
    const [side, station] = entry;
    client.side = side;
    client.token = token;
    station.connected = true;
    station.socket = client.socket;
    station.practiceActive = false;
    this.touch(station);
    logEvent("info", side, "station session reattached");
    this.broadcast();
  }

  claim(client: Client, side: Side, profile: PublicProfile): void {
    const existing = this.stations.get(side);
    if (existing?.connected) {
      this.send(client, {
        type: "error",
        message: `Station ${side} is already in use.`,
      });
      return;
    }
    const duplicate = [...this.stations.values()].find(
      (station) =>
        station.profile.githubId === profile.githubId && station.side !== side,
    );
    if (duplicate) {
      this.send(client, {
        type: "error",
        message: "That GitHub profile is already registered.",
      });
      return;
    }
    const token = randomBytes(24).toString("base64url");
    const station: Station = {
      side,
      profile,
      practiceCount: 0,
      ready: false,
      connected: true,
      cursorIndex: 0,
      wpm: 0,
      accuracy: 100,
      token,
      socket: client.socket,
      lastSequence: -1,
      lastActivityAt: Date.now(),
      afkWarned: false,
      practiceActive: false,
    };
    this.stations.set(side, station);
    client.role = "station";
    client.side = side;
    client.token = token;
    this.database.saveProfile(profile);
    logEvent("info", side, `registered @${profile.login}`);
    this.send(client, { type: "claimed", side, stationToken: token, profile });
    this.phase = "registration";
    this.broadcast();
  }

  handle(client: Client, message: ClientMessage): void {
    if (message.type === "hello") {
      this.attach(client, message.role, message.stationToken);
      return;
    }
    if (message.type === "clientLog") {
      logEvent(message.level, client.side ?? "leaderboard", message.message);
      return;
    }
    const station = client.side ? this.stations.get(client.side) : undefined;
    if (!station || station.token !== client.token) {
      this.send(client, {
        type: "error",
        message: "Register this station first.",
      });
      return;
    }
    if (message.type === "activity") {
      if (station.practiceActive) this.touch(station);
      return;
    }
    switch (message.type) {
      case "practiceStart":
        if (
          station.practiceCount >= 2 ||
          this.phase === "countdown" ||
          this.phase === "racing" ||
          this.phase === "results"
        ) {
          return;
        }
        station.practiceActive = true;
        this.touch(station);
        break;
      case "practiceComplete":
        if (!station.practiceActive) return;
        this.advancePractice(station);
        break;
      case "skipPractice":
        if (
          station.practiceCount >= 2 ||
          this.phase === "countdown" ||
          this.phase === "racing" ||
          this.phase === "results"
        ) {
          return;
        }
        logEvent(
          "info",
          station.side,
          `skipped practice ${station.practiceCount + 1}`,
        );
        this.advancePractice(station);
        break;
      case "ready":
        if (station.practiceCount < 2) {
          this.send(client, {
            type: "error",
            message: "Complete both practice runs first.",
          });
          return;
        }
        station.ready = message.ready;
        station.practiceActive = false;
        this.phase = "lobby";
        this.broadcast();
        this.maybeStart();
        break;
      case "progress":
        if (
          this.phase !== "racing" ||
          message.sequence <= station.lastSequence
        ) {
          return;
        }
        station.lastSequence = message.sequence;
        station.cursorIndex = Math.max(0, message.cursorIndex);
        station.wpm = Math.max(0, message.wpm);
        station.accuracy = Math.max(0, Math.min(100, message.accuracy));
        this.broadcast();
        break;
      case "finish":
        this.finish(station, message.result);
        break;
      case "release":
        this.release(client);
        break;
      case "rematch":
        if (this.phase !== "results") return;
        station.ready = true;
        this.broadcast();
        this.maybeStart();
        break;
      default:
        break;
    }
  }

  release(client: Client, reason = "logged out"): void {
    if (
      !client.side ||
      this.phase === "racing" ||
      this.phase === "countdown" ||
      this.phase === "results"
    ) {
      return;
    }
    const side = client.side;
    this.stations.delete(side);
    client.side = undefined;
    client.token = undefined;
    this.phase = "registration";
    this.results = [];
    this.race = undefined;
    this.clearRaceTimers();
    logEvent("info", side, `station released: ${reason}`);
    this.broadcast();
  }

  forceReset(target: Side | "all" = "all", reason = "operator reset"): void {
    if (
      target === "all" ||
      this.phase === "countdown" ||
      this.phase === "racing"
    ) {
      this.resetRoom(reason);
      return;
    }
    this.stations.delete(target);
    for (const client of this.clients) {
      if (client.side === target) {
        client.side = undefined;
        client.token = undefined;
      }
    }
    this.phase = "registration";
    this.results = [];
    this.race = undefined;
    this.clearRaceTimers();
    logEvent("warn", target, `station reset: ${reason}`);
    this.broadcast();
  }

  forceRefresh(target: Side | "leaderboard" | "all"): void {
    for (const client of this.clients) {
      const matches =
        target === "all" ||
        (target === "leaderboard" && client.role === "spectator") ||
        client.side === target;
      if (matches) this.send(client, { type: "control", action: "refresh" });
    }
    logEvent("warn", "backend", `operator refresh sent to ${target}`);
  }

  clientStatus(): { source: Side | "leaderboard"; connected: boolean }[] {
    const status: { source: Side | "leaderboard"; connected: boolean }[] = [];
    for (const side of ["L", "R"] as const) {
      status.push({
        source: side,
        connected: this.stations.get(side)?.connected ?? false,
      });
    }
    status.push({
      source: "leaderboard",
      connected: [...this.clients].some(
        (client) => client.role === "spectator",
      ),
    });
    return status;
  }

  snapshot(): RoomSnapshot {
    const stations: RoomSnapshot["stations"] = {};
    for (const [side, station] of this.stations) {
      stations[side] = {
        side,
        profile: station.profile,
        practiceCount: station.practiceCount,
        ready: station.ready,
        connected: station.connected,
        cursorIndex: station.cursorIndex,
        wpm: station.wpm,
        accuracy: station.accuracy,
        ...(station.practiceActive
          ? {
              afkWarningAt: station.lastActivityAt + AFK_WARNING_MS,
              afkResetAt: station.lastActivityAt + AFK_RESET_MS,
            }
          : {}),
      };
    }
    return {
      phase: this.phase,
      stations,
      race: this.race,
      results: this.results,
      leaderboard: this.database.leaderboard(),
      serverNow: Date.now(),
      resultsResetAt: this.resultsResetAt,
    };
  }

  private maybeStart(): void {
    const left = this.stations.get("L"),
      right = this.stations.get("R");
    if (!left?.ready || !right?.ready || !left.connected || !right.connected) {
      return;
    }
    for (const station of [left, right]) {
      station.practiceActive = false;
      station.afkWarned = false;
      station.ready = false;
      station.cursorIndex = 0;
      station.wpm = 0;
      station.accuracy = 100;
      station.lastSequence = -1;
    }
    this.results = [];
    this.race = {
      id: randomUUID(),
      text: createRaceText(this.words),
      startAt: Date.now() + 4_000,
      durationSeconds: this.durationSeconds,
    };
    this.phase = "countdown";
    this.resultsResetAt = undefined;
    clearTimeout(this.resultsTimer);
    logEvent("info", "backend", `race ${this.race.id} countdown started`);
    this.broadcast();
    clearTimeout(this.countdownTimer);
    this.countdownTimer = setTimeout(() => {
      this.countdownTimer = undefined;
      if (this.phase === "countdown") {
        this.phase = "racing";
        this.broadcast();
      }
    }, 4_000);
    clearTimeout(this.raceTimer);
    this.raceTimer = setTimeout(
      () => this.finalize(),
      4_000 + this.durationSeconds * 1_000 + 1_500,
    );
  }

  private finish(
    station: Station,
    raw: Omit<RaceResult, "side" | "profile" | "finishedAt">,
  ): void {
    if (
      this.phase !== "racing" ||
      !this.race ||
      this.results.some((result) => result.side === station.side)
    ) {
      return;
    }
    const result: RaceResult = {
      side: station.side,
      profile: station.profile,
      wpm: clamp(raw.wpm, 0, 400),
      raw: clamp(raw.raw, 0, 500),
      accuracy: clamp(raw.accuracy, 0, 100),
      consistency: clamp(raw.consistency, 0, 100),
      correctChars: Math.max(0, Math.floor(raw.correctChars)),
      incorrectChars: Math.max(0, Math.floor(raw.incorrectChars)),
      finishedAt: Date.now(),
    };
    this.results.push(result);
    logEvent(
      "info",
      station.side,
      `finished at ${result.wpm.toFixed(1)} adjusted WPM (${result.raw.toFixed(1)} raw)`,
    );
    this.broadcast();
    if (this.results.length === 2) this.finalize();
  }

  private finalize(): void {
    if (!this.race || (this.phase !== "racing" && this.phase !== "countdown")) {
      return;
    }
    clearTimeout(this.raceTimer);
    this.phase = "results";
    this.resultsResetAt = Date.now() + RESULTS_RESET_MS;
    this.database.saveRace(
      this.race.id,
      this.race.startAt,
      this.race.durationSeconds,
      this.results,
    );
    this.broadcast();
    logEvent(
      "info",
      "backend",
      `race ${this.race.id} finalized; reset in 15 seconds`,
    );
    clearTimeout(this.resultsTimer);
    this.resultsTimer = setTimeout(
      () => this.resetRoom("post-race timeout"),
      RESULTS_RESET_MS,
    );
  }

  private touch(station: Station): void {
    station.lastActivityAt = Date.now();
    station.afkWarned = false;
    if (station.practiceActive) this.broadcast();
  }

  private advancePractice(station: Station): void {
    station.practiceActive = false;
    station.afkWarned = false;
    station.practiceCount = Math.min(2, station.practiceCount + 1);
    if ([...this.stations.values()].some((item) => item.practiceCount >= 2)) {
      this.phase = "lobby";
    }
    this.broadcast();
  }

  private checkAfk(): void {
    const now = Date.now();
    for (const [side, station] of this.stations) {
      if (!station.practiceActive) continue;
      if (now >= station.lastActivityAt + AFK_RESET_MS) {
        logEvent("warn", side, "station reset after 20 seconds of inactivity");
        this.forceReset(side, "AFK timeout");
        continue;
      }
      if (
        !station.afkWarned &&
        now >= station.lastActivityAt + AFK_WARNING_MS
      ) {
        station.afkWarned = true;
        logEvent("warn", side, "AFK warning displayed");
        this.broadcast();
      }
    }
  }

  private clearRaceTimers(): void {
    clearTimeout(this.countdownTimer);
    clearTimeout(this.raceTimer);
    clearTimeout(this.resultsTimer);
    this.countdownTimer = undefined;
    this.raceTimer = undefined;
    this.resultsTimer = undefined;
    this.resultsResetAt = undefined;
  }

  dispose(): void {
    clearInterval(this.housekeepingTimer);
    this.clearRaceTimers();
  }

  private resetRoom(reason: string): void {
    this.clearRaceTimers();
    this.stations.clear();
    this.results = [];
    this.race = undefined;
    this.phase = "registration";
    for (const client of this.clients) {
      client.side = undefined;
      client.token = undefined;
    }
    logEvent("warn", "backend", `room reset: ${reason}`);
    this.broadcast();
  }

  private broadcast(): void {
    const message: ServerMessage = {
      type: "snapshot",
      snapshot: this.snapshot(),
    };
    for (const client of this.clients) this.send(client, message);
  }

  private send(client: Client, message: ServerMessage): void {
    if (client.socket.readyState === client.socket.OPEN) {
      client.socket.send(JSON.stringify(message));
    }
  }
}

function createRaceText(words: string[], count = 120): string {
  const chosen: string[] = [];
  for (let index = 0; index < count; index++) {
    chosen.push(words[Math.floor(Math.random() * words.length)] ?? "type");
  }
  return chosen.join(" ");
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : minimum;
}
