# Monkeytype Duel

A compact event-focused typing duel derived from Monkeytype. The Vite client is deployed to GitHub Pages; one Node process on the event VPS provides GitHub public-profile lookup, WebSocket race coordination, and SQLite-backed results.

## Development

```bash
pnpm install
pnpm --dir duel-app dev
```

Open `http://localhost:5173`. Use separate browser profiles or private windows for stations L and R, and `/#/spectate` for the spectator view.

The operator dashboard is at `http://localhost:5173/admin.html`. Set
`ADMIN_TOKEN` on the server and enter that token in the dashboard. The token is
kept in browser session storage, is never included in the Pages build, and is
required for status, log, reset, and refresh requests.

## Production

Build the static client and server:

```bash
VITE_API_URL=https://api.keeb.makerspace.tools pnpm --dir duel-app build
```

The Pages artifact is `duel-app/dist-web`. The server entry point is `duel-app/dist-server/server/index.js`.

Production service templates live in `deploy/`. They run the Node process as the
unprivileged `monkeytype-duel` user, bind it to loopback, and expose only Caddy
on ports 80/443. Caddy obtains and renews the TLS certificate automatically.

Runtime state is stored in one SQLite file configured by `DATABASE_PATH`. The server is deliberately single-instance; restarting during a race aborts that in-memory race while preserving completed results.

Stations show an AFK warning after 10 seconds without interaction and are
released at 20 seconds. Results remain visible for 15 seconds before both
stations reset. Race countdown and active typing are excluded from AFK expiry.
The dashboard retains the latest 500 backend/station events in memory; systemd
remains the durable source for service logs.

Monkeytype and this derivative are licensed under GPL-3.0.
