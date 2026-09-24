import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import express from "express";
import { WebSocketServer } from "ws";
import type { ClientMessage } from "../shared/protocol.js";
import { DuelDatabase } from "./database.js";
import { ProfileError, resolveGithubProfile } from "./github.js";
import { DuelRoom } from "./room.js";

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";
const databasePath =
  process.env.DATABASE_PATH ?? join(process.cwd(), "data", "duel.sqlite");
mkdirSync(dirname(databasePath), { recursive: true });
const database = new DuelDatabase(databasePath);
const words = (
  JSON.parse(readFileSync(join(here, "data", "english_1k.json"), "utf8")) as {
    words: string[];
  }
).words;
const room = new DuelRoom(
  database,
  words,
  Number(process.env.RACE_DURATION_SECONDS ?? 30),
);
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "32kb" }));

app.use((req, res, next) => {
  const allowed =
    process.env.ALLOWED_ORIGIN?.split(",")
      .map((value) => value.trim())
      .filter(Boolean) ?? [];
  const origin = req.headers.origin;
  if (
    origin !== undefined &&
    (allowed.length === 0 || allowed.includes(origin))
  ) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    uptime: Math.floor(process.uptime()),
    clients: room.snapshot().stations,
  });
});
app.get("/api/profile/:login", async (req, res) => {
  try {
    res.json(await resolveGithubProfile(String(req.params.login), database));
  } catch (error) {
    const status = error instanceof ProfileError ? error.status : 500;
    res.status(status).json({
      error: error instanceof Error ? error.message : "Profile lookup failed.",
    });
  }
});
app.get("/api/leaderboard", (_req, res) => {
  res.json(database.leaderboard());
});
app.get("/api/snapshot", (_req, res) => {
  res.json(room.snapshot());
});

const staticDir = process.env.STATIC_DIR;
if (staticDir !== undefined && existsSync(staticDir)) {
  app.use(express.static(staticDir, { maxAge: "1h", extensions: ["html"] }));
}

const server = http.createServer(app);
const sockets = new WebSocketServer({
  server,
  path: "/ws",
  maxPayload: 16_384,
});
sockets.on("connection", (socket, request) => {
  const allowed =
    process.env.ALLOWED_ORIGIN?.split(",")
      .map((value) => value.trim())
      .filter(Boolean) ?? [];
  if (
    request.headers.origin !== undefined &&
    allowed.length > 0 &&
    !allowed.includes(request.headers.origin)
  ) {
    socket.close(1008, "Origin not allowed");
    return;
  }
  const client = room.addClient(socket);
  socket.on("message", async (buffer) => {
    try {
      const payload = Array.isArray(buffer)
        ? Buffer.concat(buffer).toString("utf8")
        : buffer instanceof ArrayBuffer
          ? Buffer.from(buffer).toString("utf8")
          : buffer.toString("utf8");
      const message = JSON.parse(payload) as ClientMessage;
      if (message.type === "claim") {
        room.claim(
          client,
          message.side,
          await resolveGithubProfile(message.githubLogin, database),
        );
      } else {
        room.handle(client, message);
      }
    } catch (error) {
      socket.send(
        JSON.stringify({
          type: "error",
          message: error instanceof Error ? error.message : "Invalid message.",
        }),
      );
    }
  });
  socket.on("close", () => room.removeClient(client));
});

server.listen(port, host, () =>
  console.log(
    JSON.stringify({
      level: "info",
      message: "monkeytype duel listening",
      host,
      port,
      databasePath,
    }),
  ),
);

function shutdown(signal: string): void {
  console.log(
    JSON.stringify({ level: "info", message: "shutting down", signal }),
  );
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 8_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
