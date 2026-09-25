import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicProfile } from "../shared/protocol.js";
import { DuelRoom } from "./room.js";

class FakeSocket {
  OPEN = 1;
  readyState = 1;
  messages: unknown[] = [];
  send(value: string): void {
    this.messages.push(JSON.parse(value));
  }
}

const left: PublicProfile = {
  githubId: 1,
  login: "left",
  displayName: "Left Player",
  avatarUrl: "https://example.com/l.png",
};
const right: PublicProfile = {
  githubId: 2,
  login: "right",
  displayName: "Right Player",
  avatarUrl: "https://example.com/r.png",
};

describe("DuelRoom", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });
  afterEach(() => vi.useRealTimers());

  it("tracks a connected spectator display separately from stations", () => {
    const database = {
      saveProfile: vi.fn(),
      leaderboard: vi.fn(() => []),
      saveRace: vi.fn(),
    };
    const room = new DuelRoom(database as never, ["type"]);
    const socket = new FakeSocket();
    const client = room.addClient(socket as never);
    room.handle(client, { type: "hello", role: "spectator" });
    expect(room.clientStatus()).toContainEqual({
      source: "leaderboard",
      connected: true,
    });
  });

  it("requires two practices and starts one synchronized race when both players are ready", () => {
    const database = {
      saveProfile: vi.fn(),
      leaderboard: vi.fn(() => []),
      saveRace: vi.fn(),
    };
    const room = new DuelRoom(database as never, ["type", "fast", "race"], 30);
    const lSocket = new FakeSocket(),
      rSocket = new FakeSocket();
    const lClient = room.addClient(lSocket as never),
      rClient = room.addClient(rSocket as never);
    room.claim(lClient, "L", left);
    room.claim(rClient, "R", right);
    for (let i = 0; i < 2; i++) {
      room.handle(lClient, { type: "practiceStart" });
      room.handle(lClient, { type: "practiceComplete" });
      room.handle(rClient, { type: "practiceStart" });
      room.handle(rClient, { type: "practiceComplete" });
    }
    room.handle(lClient, { type: "ready", ready: true });
    room.handle(rClient, { type: "ready", ready: true });
    expect(room.snapshot().phase).toBe("countdown");
    expect(room.snapshot().race?.startAt).toBe(1_004_000);
    vi.advanceTimersByTime(4_000);
    expect(room.snapshot().phase).toBe("racing");
  });

  it("prevents one GitHub profile from claiming both stations", () => {
    const database = {
      saveProfile: vi.fn(),
      leaderboard: vi.fn(() => []),
      saveRace: vi.fn(),
    };
    const room = new DuelRoom(database as never, ["type"]);
    const first = room.addClient(new FakeSocket() as never);
    const secondSocket = new FakeSocket();
    const second = room.addClient(secondSocket as never);
    room.claim(first, "L", left);
    room.claim(second, "R", left);
    expect(room.snapshot().stations.R).toBeUndefined();
    expect(
      secondSocket.messages.some(
        (value) => (value as { type?: string }).type === "error",
      ),
    ).toBe(true);
  });

  it("only times out an active practice and resets on activity", () => {
    const database = {
      saveProfile: vi.fn(),
      leaderboard: vi.fn(() => []),
      saveRace: vi.fn(),
    };
    const room = new DuelRoom(database as never, ["type"]);
    const socket = new FakeSocket();
    const client = room.addClient(socket as never);
    room.claim(client, "L", left);

    expect(room.snapshot().stations.L?.afkWarningAt).toBeUndefined();
    vi.advanceTimersByTime(30_000);
    expect(room.snapshot().stations.L).toBeDefined();

    room.handle(client, { type: "practiceStart" });
    expect(room.snapshot().stations.L?.afkWarningAt).toBe(1_040_000);
    expect(room.snapshot().stations.L?.afkResetAt).toBe(1_050_000);
    vi.advanceTimersByTime(10_000);
    const messagesBeforeActivity = socket.messages.length;
    room.handle(client, { type: "activity" });
    expect(socket.messages.length).toBeGreaterThan(messagesBeforeActivity);
    expect(room.snapshot().stations.L?.afkWarningAt).toBe(1_050_000);
    expect(room.snapshot().stations.L?.afkResetAt).toBe(1_060_000);
    vi.advanceTimersByTime(19_500);
    expect(room.snapshot().stations.L).toBeDefined();
    vi.advanceTimersByTime(500);
    expect(room.snapshot().stations.L).toBeUndefined();
  });

  it("does not run the AFK timer between practices or in the lobby", () => {
    const database = {
      saveProfile: vi.fn(),
      leaderboard: vi.fn(() => []),
      saveRace: vi.fn(),
    };
    const room = new DuelRoom(database as never, ["type"]);
    const client = room.addClient(new FakeSocket() as never);
    room.claim(client, "L", left);
    for (let i = 0; i < 2; i++) {
      room.handle(client, { type: "practiceStart" });
      room.handle(client, { type: "practiceComplete" });
      expect(room.snapshot().stations.L?.afkResetAt).toBeUndefined();
      vi.advanceTimersByTime(30_000);
      expect(room.snapshot().stations.L).toBeDefined();
    }
    expect(room.snapshot().phase).toBe("lobby");
  });

  it("clears both stations 15 seconds after race results", () => {
    const database = {
      saveProfile: vi.fn(),
      leaderboard: vi.fn(() => []),
      saveRace: vi.fn(),
    };
    const room = new DuelRoom(database as never, ["type"], 30);
    const lClient = room.addClient(new FakeSocket() as never);
    const rClient = room.addClient(new FakeSocket() as never);
    room.claim(lClient, "L", left);
    room.claim(rClient, "R", right);
    for (let i = 0; i < 2; i++) {
      room.handle(lClient, { type: "practiceStart" });
      room.handle(lClient, { type: "practiceComplete" });
      room.handle(rClient, { type: "practiceStart" });
      room.handle(rClient, { type: "practiceComplete" });
    }
    room.handle(lClient, { type: "ready", ready: true });
    room.handle(rClient, { type: "ready", ready: true });
    vi.advanceTimersByTime(4_000);
    const result = {
      wpm: 80,
      raw: 90,
      accuracy: 95,
      consistency: 88,
      correctChars: 200,
      incorrectChars: 4,
    };
    room.handle(lClient, { type: "finish", result });
    room.handle(rClient, { type: "finish", result });

    expect(room.snapshot().phase).toBe("results");
    expect(room.snapshot().resultsResetAt).toBe(1_019_000);
    vi.advanceTimersByTime(14_999);
    expect(room.snapshot().stations.L).toBeDefined();
    vi.advanceTimersByTime(1);
    expect(room.snapshot().phase).toBe("registration");
    expect(room.snapshot().stations).toEqual({});
  });
});
