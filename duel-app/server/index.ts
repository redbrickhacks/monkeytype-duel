import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import express from "express";
import { WebSocketServer } from "ws";
import { DuelDatabase } from "./database.js";
import { ProfileError, resolveGithubProfile } from "./github.js";
import { DuelRoom } from "./room.js";
import { parseClientMessage } from "./validation.js";
import { logEvent, recentLogs } from "./logger.js";
import type { AdminTarget } from "../shared/protocol.js";

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
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
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

function requireAdmin(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  const token = process.env.ADMIN_TOKEN;
  if (token === undefined || token === "") {
    res.status(503).json({ error: "Operator dashboard is not configured." });
    return;
  }
  if (req.headers.authorization !== `Bearer ${token}`) {
    res.status(401).json({ error: "Invalid operator token." });
    return;
  }
  next();
}

app.get("/api/admin/status", requireAdmin, (req, res) => {
  const after = Number(req.query.after ?? 0);
  res.json({
    snapshot: room.snapshot(),
    clients: room.clientStatus(),
    logs: recentLogs(Number.isFinite(after) ? after : 0),
  });
});

app.post("/api/admin/action", requireAdmin, (req, res) => {
  const body = req.body as { action?: unknown; target?: unknown };
  const targets: AdminTarget[] = ["L", "R", "leaderboard", "all"];
  if (
    (body.action !== "reset" && body.action !== "refresh") ||
    !targets.includes(body.target as AdminTarget)
  ) {
    res.status(400).json({ error: "Invalid operator action." });
    return;
  }
  const target = body.target as AdminTarget;
  if (body.action === "reset") {
    if (target === "leaderboard") {
      res
        .status(400)
        .json({ error: "The leaderboard has no station to reset." });
      return;
    }
    room.forceReset(target);
  } else {
    room.forceRefresh(target);
  }
  res.json({ ok: true });
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
      const message = parseClientMessage(JSON.parse(payload) as unknown);
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
      logEvent(
        "error",
        client.side ?? "backend",
        error instanceof Error ? error.message : "Invalid client message.",
      );
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
  logEvent("info", "backend", `monkeytype duel listening on ${host}:${port}`),
);

function shutdown(signal: string): void {
  logEvent("info", "backend", `shutting down (${signal})`);
  room.dispose();
  server.close();
  for (const socket of sockets.clients) {
    socket.close(1012, "Service restarting");
  }
  setTimeout(() => {
    for (const socket of sockets.clients) {
      socket.terminate();
    }
    database.close();
    process.exit(0);
  }, 500).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
