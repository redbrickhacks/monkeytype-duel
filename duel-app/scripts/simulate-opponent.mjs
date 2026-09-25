import { WebSocket } from "ws";

const socket = new WebSocket(
  process.env.DUEL_WS_URL ?? "ws://localhost:3000/ws",
  { origin: process.env.DUEL_ORIGIN ?? "http://localhost:5173" },
);
let token;
let claimed = false;
let reserved = false;
let lastPracticeCount = -1;
let finishSent = false;

socket.on("open", () =>
  socket.send(JSON.stringify({ type: "hello", role: "station" })),
);
socket.on("message", (raw) => {
  const message = JSON.parse(raw.toString());
  if (message.type === "snapshot") {
    const station = message.snapshot.stations.R;
    if (!reserved && !station && !message.snapshot.reservations.R) {
      reserved = true;
      socket.send(
        JSON.stringify({
          type: "reserveSide",
          side: "R",
          selectedAt: Date.now(),
        }),
      );
    }
    if (
      station &&
      token &&
      station.practiceCount < 2 &&
      station.practiceCount !== lastPracticeCount
    ) {
      lastPracticeCount = station.practiceCount;
      socket.send(JSON.stringify({ type: "skipPractice" }));
    }
    if (
      station &&
      token &&
      station.practiceCount >= 2 &&
      message.snapshot.phase === "racing" &&
      !finishSent
    ) {
      finishSent = true;
      socket.send(
        JSON.stringify({
          type: "progress",
          sequence: Date.now(),
          cursorIndex: 24,
          wpm: 82,
          raw: 85,
          accuracy: 98,
        }),
      );
      setTimeout(
        () =>
          socket.send(
            JSON.stringify({
              type: "finish",
              result: {
                wpm: 82,
                raw: 85,
                accuracy: 98,
                consistency: 91,
                correctChars: 205,
                incorrectChars: 4,
              },
            }),
          ),
        1500,
      );
    }
  }
  if (message.type === "claimed") {
    token = message.stationToken;
    claimed = true;
    console.log(`claimed station ${message.side} as ${message.profile.login}`);
  }
  if (message.type === "reservation" && message.granted && !claimed) {
    socket.send(
      JSON.stringify({
        type: "claim",
        side: "R",
        githubLogin: process.env.DUEL_GITHUB_LOGIN ?? "defunkt",
      }),
    );
  }
  if (message.type === "error") console.error(message.message);
});

setTimeout(() => {
  console.log("opponent simulation complete");
  socket.close();
}, 20_000);
