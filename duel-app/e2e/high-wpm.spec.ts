import { expect, test, type Page } from "@playwright/test";

const KEY_DELAY_MS = 40; // 300 WPM using the conventional five-character word.
const SAMPLE_WORDS = 18;

type Measurements = {
  caretIndex: number;
  expectedIndex: number;
  incorrectLetters: number;
  keyCount: number;
  medianHandlerLatency: number;
  p95HandlerLatency: number;
  medianPaintLatency: number;
  p95PaintLatency: number;
  maxPaintLatency: number;
  p95KeyInterval: number;
  longTasks: number;
};

type PublicProfile = {
  githubId: number;
  login: string;
  displayName: string;
  avatarUrl: string;
};

const leftProfile: PublicProfile = {
  githubId: 1,
  login: "fast-left",
  displayName: "Fast Left",
  avatarUrl: "",
};
const rightProfile: PublicProfile = {
  githubId: 2,
  login: "fast-right",
  displayName: "Fast Right",
  avatarUrl: "",
};

test("300 WPM remains aligned and responsive with final-race telemetry", async ({
  browser,
}, testInfo) => {
  const practicePage = await browser.newPage();
  await installMeasurementsAndSocket(practicePage);
  const practiceText = await openPractice(practicePage);
  const practice = await typeAndMeasure(practicePage, practiceText);
  await practicePage.close();

  const finalPage = await browser.newPage();
  await installMeasurementsAndSocket(finalPage);
  const finalText = await openFinalWithTelemetry(finalPage);
  const final = await typeAndMeasure(finalPage, finalText);
  await finalPage.close();

  const report = { targetWpm: 300, practice, final };
  await testInfo.attach("high-wpm-metrics.json", {
    body: JSON.stringify(report, null, 2),
    contentType: "application/json",
  });
  console.log(`HIGH_WPM_METRICS ${JSON.stringify(report)}`);

  for (const result of [practice, final]) {
    expect(result.keyCount).toBe(result.expectedIndex);
    expect(result.caretIndex).toBe(result.expectedIndex);
    expect(result.incorrectLetters).toBe(0);
    expect(result.longTasks).toBe(0);
    expect(result.p95HandlerLatency).toBeLessThan(12);
  }

  // Network snapshots may move the opponent ghost, but they should not make
  // local input materially less responsive than the same practice workload.
  expect(final.p95HandlerLatency).toBeLessThanOrEqual(
    Math.max(5, practice.p95HandlerLatency * 1.75),
  );
  expect(final.p95KeyInterval).toBeLessThanOrEqual(
    practice.p95KeyInterval + 12,
  );
});

async function installMeasurementsAndSocket(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state = {
      paintLatencies: [] as number[],
      handlerLatencies: [] as number[],
      keyTimes: [] as number[],
      longTasks: 0,
      socket: undefined as
        | (EventTarget & {
            readyState: number;
            receive(message: unknown): void;
          })
        | undefined,
    };
    Object.defineProperty(window, "__duelTest", { value: state });

    window.addEventListener(
      "keydown",
      (event) => {
        if (event.key.length !== 1 && event.key !== "Backspace") return;
        const startedAt = performance.now();
        state.keyTimes.push(startedAt);
        queueMicrotask(() => {
          state.handlerLatencies.push(performance.now() - startedAt);
        });
        requestAnimationFrame(() => {
          state.paintLatencies.push(performance.now() - startedAt);
        });
      },
      true,
    );

    try {
      new PerformanceObserver((entries) => {
        state.longTasks += entries.getEntries().length;
      }).observe({ type: "longtask", buffered: true });
    } catch {
      // Long-task observation is not available in every browser build.
    }

    class FakeWebSocket extends EventTarget {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSING = 2;
      static readonly CLOSED = 3;
      readonly url: string;
      readyState = FakeWebSocket.CONNECTING;
      bufferedAmount = 0;
      extensions = "";
      protocol = "";
      binaryType: BinaryType = "blob";

      constructor(url: string | URL) {
        super();
        this.url = String(url);
        state.socket = this;
        setTimeout(() => {
          this.readyState = FakeWebSocket.OPEN;
          this.dispatchEvent(new Event("open"));
        });
      }

      send(): void {
        // The fixture intentionally accepts outbound client telemetry.
      }

      close(): void {
        this.readyState = FakeWebSocket.CLOSED;
        this.dispatchEvent(new CloseEvent("close"));
      }

      receive(message: unknown): void {
        this.dispatchEvent(
          new MessageEvent("message", { data: JSON.stringify(message) }),
        );
      }
    }

    Object.defineProperty(window, "WebSocket", { value: FakeWebSocket });
  });
  await page.goto("/");
  await expect(page.locator("#connectionStatus")).toHaveText("connected");
}

async function openPractice(page: Page): Promise<string> {
  await claimLeft(page, 0, "registration");
  await page.getByRole("button", { name: "start now" }).click();
  await expect(page.locator(".practice-test")).toBeVisible();
  return targetText(page);
}

async function openFinalWithTelemetry(page: Page): Promise<string> {
  const words =
    "the quick brown fox jumps over the lazy dog while skilled hands keep a steady rhythm through every line of text";
  const text = Array.from({ length: 12 }, () => words).join(" ");
  const race = {
    id: "high-wpm-race",
    text,
    startAt: Date.now() - 250,
    durationSeconds: 30,
  };
  await claimLeft(page, 2, "racing", race);
  await expect(page.locator(".test")).toBeVisible();

  await page.evaluate(
    ({ raceDefinition, left, right }) => {
      let remoteIndex = 0;
      window.setInterval(() => {
        remoteIndex = (remoteIndex + 1) % raceDefinition.text.length;
        emit({
          type: "snapshot",
          snapshot: {
            phase: "racing",
            stations: {
              L: station("L", left, 0),
              R: station("R", right, remoteIndex),
            },
            reservations: {},
            race: raceDefinition,
            results: [],
            leaderboard: [],
            serverNow: Date.now(),
          },
        });
      }, 25);

      function station(
        side: "L" | "R",
        profile: PublicProfile,
        cursorIndex: number,
      ): {
        side: "L" | "R";
        profile: PublicProfile;
        practiceCount: number;
        ready: boolean;
        connected: boolean;
        cursorIndex: number;
        wpm: number;
        rawWpm: number;
        accuracy: number;
      } {
        return {
          side,
          profile,
          practiceCount: 2,
          ready: true,
          connected: true,
          cursorIndex,
          wpm: side === "R" ? 300 : 0,
          rawWpm: side === "R" ? 300 : 0,
          accuracy: 100,
        };
      }

      function emit(message: unknown): void {
        (
          window as typeof window & {
            __duelTest: { socket?: { receive(value: unknown): void } };
          }
        ).__duelTest.socket?.receive(message);
      }
    },
    { raceDefinition: race, left: leftProfile, right: rightProfile },
  );
  return targetText(page);
}

async function claimLeft(
  page: Page,
  practiceCount: number,
  phase: "registration" | "racing",
  race?: {
    id: string;
    text: string;
    startAt: number;
    durationSeconds: number;
  },
): Promise<void> {
  await page.evaluate(
    ({ count, roomPhase, raceDefinition, profile, opponent }) => {
      const socket = (
        window as typeof window & {
          __duelTest: { socket?: { receive(value: unknown): void } };
        }
      ).__duelTest.socket;
      socket?.receive({
        type: "claimed",
        side: "L",
        stationToken: "test-token",
        profile,
      });
      socket?.receive({
        type: "snapshot",
        snapshot: {
          phase: roomPhase,
          stations: {
            L: {
              side: "L",
              profile,
              practiceCount: count,
              ready: count >= 2,
              connected: true,
              cursorIndex: 0,
              wpm: 0,
              rawWpm: 0,
              accuracy: 100,
            },
            ...(roomPhase === "racing"
              ? {
                  R: {
                    side: "R",
                    profile: opponent,
                    practiceCount: 2,
                    ready: true,
                    connected: true,
                    cursorIndex: 0,
                    wpm: 0,
                    rawWpm: 0,
                    accuracy: 100,
                  },
                }
              : {}),
          },
          reservations: {},
          ...(raceDefinition ? { race: raceDefinition } : {}),
          results: [],
          leaderboard: [],
          serverNow: Date.now(),
        },
      });
    },
    {
      count: practiceCount,
      roomPhase: phase,
      raceDefinition: race,
      profile: leftProfile,
      opponent: rightProfile,
    },
  );
}

async function targetText(page: Page): Promise<string> {
  return page.locator(".word").evaluateAll(
    (words, count) =>
      words
        .slice(0, count)
        .map((word) =>
          Array.from(word.querySelectorAll<HTMLElement>(":scope > .letter"))
            .map((letter) => letter.textContent ?? "")
            .filter((character) => character !== "\u00a0")
            .join(""),
        )
        .join(" "),
    SAMPLE_WORDS,
  );
}

async function typeAndMeasure(page: Page, text: string): Promise<Measurements> {
  await page.locator(".test").focus();
  await page.evaluate(() => {
    const state = (
      window as typeof window & {
        __duelTest: {
          paintLatencies: number[];
          handlerLatencies: number[];
          keyTimes: number[];
          longTasks: number;
        };
      }
    ).__duelTest;
    state.paintLatencies.length = 0;
    state.handlerLatencies.length = 0;
    state.keyTimes.length = 0;
    state.longTasks = 0;
  });

  await page.keyboard.type(text, { delay: KEY_DELAY_MS });
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          (
            window as typeof window & {
              __duelTest: { paintLatencies: number[] };
            }
          ).__duelTest.paintLatencies.length,
      ),
    )
    .toBe(text.length);

  return page.evaluate((expectedIndex) => {
    const state = (
      window as typeof window & {
        __duelTest: {
          paintLatencies: number[];
          handlerLatencies: number[];
          keyTimes: number[];
          longTasks: number;
        };
      }
    ).__duelTest;
    const intervals = state.keyTimes
      .slice(1)
      .map((time, index) => time - (state.keyTimes[index] ?? time));
    return {
      caretIndex: Number(
        document.querySelector<HTMLElement>(".local-caret")?.dataset.index ??
          -1,
      ),
      expectedIndex,
      incorrectLetters: document.querySelectorAll(".letter.incorrect").length,
      keyCount: state.keyTimes.length,
      medianHandlerLatency: percentile(state.handlerLatencies, 0.5),
      p95HandlerLatency: percentile(state.handlerLatencies, 0.95),
      medianPaintLatency: percentile(state.paintLatencies, 0.5),
      p95PaintLatency: percentile(state.paintLatencies, 0.95),
      maxPaintLatency: Math.max(...state.paintLatencies),
      p95KeyInterval: percentile(intervals, 0.95),
      longTasks: state.longTasks,
    };

    function percentile(values: number[], fraction: number): number {
      const sorted = [...values].sort((left, right) => left - right);
      return sorted[Math.floor((sorted.length - 1) * fraction)] ?? 0;
    }
  }, text.length);
}
