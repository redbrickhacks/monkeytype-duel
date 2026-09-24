import { WebSocket } from "ws";

const socket = new WebSocket(
  process.env.DUEL_WS_URL ?? "ws://localhost:3000/ws",
  { origin: process.env.DUEL_ORIGIN ?? "http://localhost:5173" },
);
let token;
let claimed = false;

socket.on("open", () =>
  socket.send(JSON.stringify({ type: "hello", role: "station" })),
);
socket.on("message", (raw) => {
  const message = JSON.parse(raw.toString());
  if (message.type === "snapshot") {
    const station = message.snapshot.stations.R;
    if (!claimed && !station) {
      claimed = true;
      socket.send(
        JSON.stringify({
          type: "claim",
          side: "R",
          githubLogin: process.env.DUEL_GITHUB_LOGIN ?? "defunkt",
        }),
      );
    }
    if (station && token && station.practiceCount < 2) {
      socket.send(JSON.stringify({ type: "practiceComplete" }));
    }
    if (
      station &&
      token &&
      station.practiceCount >= 2 &&
      !station.ready &&
      message.snapshot.phase !== "countdown" &&
      message.snapshot.phase !== "racing" &&
      message.snapshot.phase !== "results"
    ) {
      socket.send(JSON.stringify({ type: "ready", ready: true }));
    }
    if (message.snapshot.phase === "racing" && message.snapshot.race) {
      socket.send(
        JSON.stringify({
          type: "progress",
          sequence: Date.now(),
          cursorIndex: 24,
          wpm: 82,
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
    console.log(`claimed station ${message.side} as ${message.profile.login}`);
  }
  if (message.type === "error") console.error(message.message);
});

setTimeout(() => {
  console.log("opponent simulation complete");
  socket.close();
}, 20_000);
