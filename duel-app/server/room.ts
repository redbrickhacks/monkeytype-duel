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
} & StationState;

export class DuelRoom {
  private readonly clients = new Set<Client>();
  private readonly stations = new Map<Side, Station>();
  private race?: RaceDefinition;
  private results: RaceResult[] = [];
  private phase: RoomSnapshot["phase"] = "registration";
  private raceTimer?: NodeJS.Timeout;

  constructor(
    private readonly database: DuelDatabase,
    private readonly words: string[],
    private readonly durationSeconds = 30,
  ) {}

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
      station.connected = false;
      station.socket = undefined;
      this.broadcast();
    }
  }

  attach(client: Client, token?: string): void {
    client.role = "station";
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
    };
    this.stations.set(side, station);
    client.role = "station";
    client.side = side;
    client.token = token;
    this.database.saveProfile(profile);
    this.send(client, { type: "claimed", side, stationToken: token, profile });
    this.phase = "registration";
    this.broadcast();
  }

  handle(client: Client, message: ClientMessage): void {
    if (message.type === "hello") {
      this.attach(client, message.stationToken);
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
    switch (message.type) {
      case "practiceComplete":
        station.practiceCount = Math.min(2, station.practiceCount + 1);
        if (
          [...this.stations.values()].some((item) => item.practiceCount >= 2)
        ) {
          this.phase = "lobby";
        }
        this.broadcast();
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

  release(client: Client): void {
    if (!client.side || this.phase === "racing" || this.phase === "countdown") {
      return;
    }
    this.stations.delete(client.side);
    client.side = undefined;
    client.token = undefined;
    this.phase = this.stations.size ? "registration" : "registration";
    this.results = [];
    this.race = undefined;
    this.broadcast();
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
      };
    }
    return {
      phase: this.phase,
      stations,
      race: this.race,
      results: this.results,
      leaderboard: this.database.leaderboard(),
      serverNow: Date.now(),
    };
  }

  private maybeStart(): void {
    const left = this.stations.get("L"),
      right = this.stations.get("R");
    if (!left?.ready || !right?.ready || !left.connected || !right.connected) {
      return;
    }
    for (const station of [left, right]) {
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
    this.broadcast();
    setTimeout(() => {
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
    this.broadcast();
    if (this.results.length === 2) this.finalize();
  }

  private finalize(): void {
    if (!this.race || (this.phase !== "racing" && this.phase !== "countdown")) {
      return;
    }
    clearTimeout(this.raceTimer);
    this.phase = "results";
    this.database.saveRace(
      this.race.id,
      this.race.startAt,
      this.race.durationSeconds,
      this.results,
    );
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
