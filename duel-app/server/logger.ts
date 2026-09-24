import type { AdminLogEntry } from "../shared/protocol.js";

const entries: AdminLogEntry[] = [];
let nextId = 1;

export function logEvent(
  level: AdminLogEntry["level"],
  source: AdminLogEntry["source"],
  message: string,
): void {
  const entry: AdminLogEntry = {
    id: nextId++,
    at: Date.now(),
    level,
    source,
    message,
  };
  entries.push(entry);
  if (entries.length > 500) entries.splice(0, entries.length - 500);
  console[level === "error" ? "error" : level === "warn" ? "warn" : "log"](
    JSON.stringify(entry),
  );
}

export function recentLogs(after = 0): AdminLogEntry[] {
  return entries.filter((entry) => entry.id > after);
}
