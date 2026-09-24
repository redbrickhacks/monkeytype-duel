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
      room.handle(lClient, { type: "practiceComplete" });
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
});
