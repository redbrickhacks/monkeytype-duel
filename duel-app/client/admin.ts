/// <reference types="vite/client" />

import "./admin.css";
import type {
  AdminLogEntry,
  AdminStatus,
  AdminTarget,
} from "../shared/protocol";

const apiUrl =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ??
  location.origin;
const tokenForm = must<HTMLFormElement>("#tokenForm");
const tokenInput = must<HTMLInputElement>("#adminToken");
const dashboard = must<HTMLElement>("#dashboard");
const summary = must<HTMLElement>("#roomSummary");
const controls = must<HTMLElement>("#controlGrid");
const logsRoot = must<HTMLElement>("#logs");
const errorRoot = must<HTMLElement>("#adminError");
const connection = must<HTMLElement>("#adminConnection");
let token = sessionStorage.getItem("duelAdminToken") ?? "";
let lastLogId = 0;
let polling = false;
const logs: AdminLogEntry[] = [];

tokenInput.value = token;
tokenForm.onsubmit = (event) => {
  event.preventDefault();
  token = tokenInput.value.trim();
  sessionStorage.setItem("duelAdminToken", token);
  lastLogId = 0;
  logs.length = 0;
  void poll();
};

must<HTMLButtonElement>("#clearLogs").onclick = () => {
  logs.length = 0;
  renderLogs();
};

async function poll(): Promise<void> {
  if (!token || polling) return;
  polling = true;
  try {
    const response = await fetch(
      `${apiUrl}/api/admin/status?after=${lastLogId}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      },
    );
    const data = (await response.json()) as AdminStatus & { error?: string };
    if (!response.ok) throw new Error(data.error ?? "Dashboard unavailable.");
    errorRoot.textContent = "";
    connection.textContent = "live";
    connection.className = "live";
    tokenForm.hidden = true;
    dashboard.hidden = false;
    logs.push(...data.logs);
    if (logs.length > 300) logs.splice(0, logs.length - 300);
    lastLogId = logs.at(-1)?.id ?? lastLogId;
    render(data);
  } catch (error) {
    connection.textContent = "offline";
    connection.className = "";
    tokenForm.hidden = false;
    dashboard.hidden = true;
    errorRoot.textContent =
      error instanceof Error ? error.message : "Dashboard unavailable.";
  } finally {
    polling = false;
  }
}

function render(status: AdminStatus): void {
  const resetAt = status.snapshot.resultsResetAt;
  const resetText =
    resetAt !== undefined
      ? ` · reset in ${Math.max(0, Math.ceil((resetAt - status.snapshot.serverNow) / 1_000))}s`
      : "";
  summary.innerHTML = `<div><small>room phase</small><strong>${status.snapshot.phase}${resetText}</strong></div><div><small>race</small><strong>${status.snapshot.race?.id.slice(0, 8) ?? "—"}</strong></div><div><small>results</small><strong>${status.snapshot.results.length}/2</strong></div>`;
  controls.innerHTML = (["L", "R", "leaderboard"] as const)
    .map((target) => {
      const station =
        target === "leaderboard" ? undefined : status.snapshot.stations[target];
      const connected =
        status.clients.find((client) => client.source === target)?.connected ??
        false;
      return `<article><div class="control-heading"><b>${target === "leaderboard" ? "board" : `station ${target}`}</b><span class="${connected ? "online" : ""}">${connected ? "online" : "offline"}</span></div><strong>${station ? escapeHtml(station.profile.displayName) : target === "leaderboard" ? "spectator display" : "unclaimed"}</strong><small>${station ? `@${escapeHtml(station.profile.login)} · ${station.wpm.toFixed(0)} wpm · ${station.accuracy.toFixed(0)}%` : ""}</small><div class="control-actions"><button data-action="refresh" data-target="${target}">force refresh</button>${target === "leaderboard" ? "" : `<button class="danger" data-action="reset" data-target="${target}">reset station</button>`}</div></article>`;
    })
    .join("");
  controls.insertAdjacentHTML(
    "beforeend",
    `<article class="all-control"><b>whole room</b><div class="control-actions"><button data-action="refresh" data-target="all">refresh all</button><button class="danger" data-action="reset" data-target="all">reset all</button></div></article>`,
  );
  controls
    .querySelectorAll<HTMLButtonElement>("[data-action]")
    .forEach((button) => {
      button.onclick = () =>
        void runAction(
          button.dataset.action as "reset" | "refresh",
          button.dataset.target as AdminTarget,
        );
    });
  renderLogs();
}

function renderLogs(): void {
  logsRoot.innerHTML = logs.length
    ? [...logs]
        .reverse()
        .map(
          (entry) =>
            `<div class="log ${entry.level}"><time>${new Date(entry.at).toLocaleTimeString()}</time><b>${entry.source}</b><span>${escapeHtml(entry.message)}</span></div>`,
        )
        .join("")
    : `<p>Waiting for events…</p>`;
}

async function runAction(
  action: "reset" | "refresh",
  target: AdminTarget,
): Promise<void> {
  if (
    action === "reset" &&
    !confirm(
      `Reset ${target === "all" ? "the whole room" : `station ${target}`} now?`,
    )
  ) {
    return;
  }
  const response = await fetch(`${apiUrl}/api/admin/action`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action, target }),
  });
  const data = (await response.json()) as { error?: string };
  if (!response.ok) errorRoot.textContent = data.error ?? "Action failed.";
  await poll();
}

window.setInterval(() => void poll(), 1_000);
if (token) void poll();

function must<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
}

function escapeHtml(value: string): string {
  const node = document.createElement("span");
  node.textContent = value;
  return node.innerHTML;
}
