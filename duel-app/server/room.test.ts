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

function reserveAndClaim(
  room: DuelRoom,
  client: ReturnType<DuelRoom["addClient"]>,
  side: "L" | "R",
  profile: PublicProfile,
): void {
  room.handle(client, { type: "reserveSide", side, selectedAt: Date.now() });
  room.claim(client, side, profile);
}

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

  it("starts one synchronized race ten seconds after both practices finish", () => {
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
    reserveAndClaim(room, lClient, "L", left);
    reserveAndClaim(room, rClient, "R", right);
    for (let i = 0; i < 2; i++) {
      room.handle(lClient, { type: "practiceStart" });
      room.handle(lClient, { type: "practiceComplete" });
      room.handle(rClient, { type: "practiceStart" });
      room.handle(rClient, { type: "practiceComplete" });
    }
    expect(room.snapshot().phase).toBe("countdown");
    expect(room.snapshot().race?.startAt).toBe(1_010_000);
    vi.advanceTimersByTime(10_000);
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
    reserveAndClaim(room, first, "L", left);
    reserveAndClaim(room, second, "R", left);
    expect(room.snapshot().stations.R).toBeUndefined();
    expect(
      secondSocket.messages.some(
        (value) => (value as { type?: string }).type === "error",
      ),
    ).toBe(true);
  });

  it("locks a side on selection and uses the earliest client epoch", () => {
    const database = {
      saveProfile: vi.fn(),
      leaderboard: vi.fn(() => []),
      saveRace: vi.fn(),
    };
    const room = new DuelRoom(database as never, ["type"]);
    const laterSocket = new FakeSocket();
    const earlierSocket = new FakeSocket();
    const later = room.addClient(laterSocket as never);
    const earlier = room.addClient(earlierSocket as never);
    room.handle(later, { type: "reserveSide", side: "L", selectedAt: 999_900 });
    room.handle(earlier, {
      type: "reserveSide",
      side: "L",
      selectedAt: 999_800,
    });
    expect(room.snapshot().reservations.L?.selectedAt).toBe(999_800);
    expect(
      laterSocket.messages.some(
        (value) =>
          (value as { type?: string; granted?: boolean }).type ===
            "reservation" && (value as { granted?: boolean }).granted === false,
      ),
    ).toBe(true);
    room.claim(later, "L", left);
    expect(room.snapshot().stations.L).toBeUndefined();
    room.claim(earlier, "L", left);
    expect(room.snapshot().stations.L?.profile.login).toBe("left");
  });

  it("resets AFK on activity and ends practice at its fixed deadline", () => {
    const database = {
      saveProfile: vi.fn(),
      leaderboard: vi.fn(() => []),
      saveRace: vi.fn(),
    };
    const room = new DuelRoom(database as never, ["type"]);
    const socket = new FakeSocket();
    const client = room.addClient(socket as never);
    reserveAndClaim(room, client, "L", left);

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
    expect(room.snapshot().stations.L).toBeDefined();
    expect(room.snapshot().stations.L?.practiceCount).toBe(1);
    expect(room.snapshot().stations.L?.practiceEndsAt).toBeUndefined();
  });

  it("does not extend a practice deadline when practice is restarted", () => {
    const database = {
      saveProfile: vi.fn(),
      leaderboard: vi.fn(() => []),
      saveRace: vi.fn(),
    };
    const room = new DuelRoom(database as never, ["type"], 30, 5);
    const client = room.addClient(new FakeSocket() as never);
    reserveAndClaim(room, client, "L", left);
    room.handle(client, { type: "practiceStart" });
    expect(room.snapshot().stations.L?.practiceEndsAt).toBe(1_005_000);
    vi.advanceTimersByTime(2_000);
    room.handle(client, { type: "practiceStart" });
    expect(room.snapshot().stations.L?.practiceEndsAt).toBe(1_005_000);
    vi.advanceTimersByTime(3_000);
    expect(room.snapshot().stations.L?.practiceCount).toBe(1);
  });

  it("does not run the AFK timer between practices or in the lobby", () => {
    const database = {
      saveProfile: vi.fn(),
      leaderboard: vi.fn(() => []),
      saveRace: vi.fn(),
    };
    const room = new DuelRoom(database as never, ["type"]);
    const client = room.addClient(new FakeSocket() as never);
    reserveAndClaim(room, client, "L", left);
    for (let i = 0; i < 2; i++) {
      room.handle(client, { type: "practiceStart" });
      room.handle(client, { type: "practiceComplete" });
      expect(room.snapshot().stations.L?.afkResetAt).toBeUndefined();
      vi.advanceTimersByTime(30_000);
      expect(room.snapshot().stations.L).toBeDefined();
    }
    expect(room.snapshot().phase).toBe("lobby");
  });

  it("can skip practice rounds but never skips the synchronized final", () => {
    const database = {
      saveProfile: vi.fn(),
      leaderboard: vi.fn(() => []),
      saveRace: vi.fn(),
    };
    const room = new DuelRoom(database as never, ["type"]);
    const client = room.addClient(new FakeSocket() as never);
    reserveAndClaim(room, client, "L", left);
    room.handle(client, { type: "skipPractice" });
    expect(room.snapshot().stations.L?.practiceCount).toBe(1);
    room.handle(client, { type: "skipPractice" });
    expect(room.snapshot().stations.L?.practiceCount).toBe(2);
    expect(room.snapshot().phase).toBe("lobby");
    room.handle(client, { type: "skipPractice" });
    expect(room.snapshot().stations.L?.practiceCount).toBe(2);
    expect(room.snapshot().race).toBeUndefined();
  });

  it("drops a refreshed practice session but preserves an active final", () => {
    const database = {
      saveProfile: vi.fn(),
      leaderboard: vi.fn(() => []),
      saveRace: vi.fn(),
    };
    const room = new DuelRoom(database as never, ["type"]);
    const practiceClient = room.addClient(new FakeSocket() as never);
    reserveAndClaim(room, practiceClient, "L", left);
    room.removeClient(practiceClient);
    expect(room.snapshot().stations.L).toBeUndefined();

    const leftClient = room.addClient(new FakeSocket() as never);
    const rightClient = room.addClient(new FakeSocket() as never);
    reserveAndClaim(room, leftClient, "L", left);
    reserveAndClaim(room, rightClient, "R", right);
    for (let index = 0; index < 2; index++) {
      room.handle(leftClient, { type: "skipPractice" });
      room.handle(rightClient, { type: "skipPractice" });
    }
    expect(room.snapshot().phase).toBe("countdown");
    room.removeClient(leftClient);
    expect(room.snapshot().stations.L).toBeDefined();
    expect(room.snapshot().stations.L?.connected).toBe(false);
    expect(room.snapshot().phase).toBe("countdown");
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
    reserveAndClaim(room, lClient, "L", left);
    reserveAndClaim(room, rClient, "R", right);
    for (let i = 0; i < 2; i++) {
      room.handle(lClient, { type: "practiceStart" });
      room.handle(lClient, { type: "practiceComplete" });
      room.handle(rClient, { type: "practiceStart" });
      room.handle(rClient, { type: "practiceComplete" });
    }
    vi.advanceTimersByTime(10_000);
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
    expect(room.snapshot().resultsResetAt).toBe(1_025_000);
    vi.advanceTimersByTime(14_999);
    expect(room.snapshot().stations.L).toBeDefined();
    vi.advanceTimersByTime(1);
    expect(room.snapshot().phase).toBe("registration");
    expect(room.snapshot().stations).toEqual({});
  });

  it("coalesces rapid progress telemetry into one broadcast", () => {
    const database = {
      saveProfile: vi.fn(),
      leaderboard: vi.fn(() => []),
      saveRace: vi.fn(),
    };
    const room = new DuelRoom(database as never, ["type"]);
    const leftSocket = new FakeSocket();
    const rightSocket = new FakeSocket();
    const leftClient = room.addClient(leftSocket as never);
    const rightClient = room.addClient(rightSocket as never);
    reserveAndClaim(room, leftClient, "L", left);
    reserveAndClaim(room, rightClient, "R", right);
    for (let index = 0; index < 2; index++) {
      room.handle(leftClient, { type: "skipPractice" });
      room.handle(rightClient, { type: "skipPractice" });
    }
    vi.advanceTimersByTime(10_000);
    const messagesBeforeProgress = rightSocket.messages.length;
    room.handle(leftClient, {
      type: "progress",
      sequence: 1,
      cursorIndex: 4,
      wpm: 80,
      raw: 84,
      accuracy: 98,
    });
    room.handle(leftClient, {
      type: "progress",
      sequence: 2,
      cursorIndex: 8,
      wpm: 82,
      raw: 86,
      accuracy: 97,
    });
    expect(rightSocket.messages).toHaveLength(messagesBeforeProgress);
    vi.advanceTimersByTime(50);
    expect(rightSocket.messages).toHaveLength(messagesBeforeProgress + 1);
    expect(room.snapshot().stations.L).toMatchObject({
      cursorIndex: 8,
      wpm: 82,
      rawWpm: 86,
    });
  });
});
