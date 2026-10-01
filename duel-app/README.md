# Monkeytype Duel

A compact event-focused typing duel derived from Monkeytype. The frontend and
backend run as independent Docker containers on `kb-local`. The Node backend
provides GitHub public-profile lookup, WebSocket race coordination, and
SQLite-backed results.

## Development

```bash
pnpm install
pnpm --dir duel-app dev
```

Open `http://localhost:5173`. Use separate browser profiles or private windows for stations L and R, and `/#/spectate` for the spectator view.

The operator dashboard is at `http://localhost:5173/admin.html`. Set
`ADMIN_TOKEN` on the server and enter that token in the dashboard. The token is
kept in browser session storage, is never included in the frontend image, and
is required for status, log, reset, and refresh requests.

## Production on kb-local

The Compose stack exposes two LAN ports:

- `192.168.8.6:8080` — static frontend
- `192.168.8.6:3000` — API and WebSocket backend

Configure the external reverse proxy with these independent upstreams:

```text
keeb.makerspace.tools      -> http://192.168.8.6:8080
api.keeb.makerspace.tools  -> http://192.168.8.6:3000
```

The API route must allow WebSocket upgrades for `/ws`. TLS terminates at the
external reverse proxy. The frontend image is compiled with
`https://api.keeb.makerspace.tools` as its public API URL.

Copy `deploy/kb-local.env.example` to `.env` on `kb-local`, set `ADMIN_TOKEN`
and optionally `GITHUB_TOKEN`, then deploy from a machine with the `kb-local`
SSH alias:

```bash
./duel-app/deploy/deploy-kb-local.sh
```

The script synchronizes only application source, builds both images on
`kb-local`, and recreates containers after both builds succeed. It deliberately
preserves the remote `.env` and `data/` directory.

Useful remote commands:

```bash
ssh kb-local 'cd /opt/monkeytype-duel/current && docker compose ps'
ssh kb-local 'cd /opt/monkeytype-duel/current && docker compose logs -f --tail=100'
```

Runtime state is stored at
`/opt/monkeytype-duel/current/data/duel.sqlite`, bind-mounted into the backend.
The backend remains deliberately single-instance; restarting it during a race
aborts that in-memory race while preserving completed results.

During each practice run, stations show an AFK warning after 10 seconds without
mouse or keyboard interaction and are released at 20 seconds. Activity restores
the full timeout. Practice-start screens, the waiting lobby, race countdown,
active races, and results are excluded from AFK expiry. Results remain visible
for 15 seconds before both stations reset.

Station credentials are kept in browser memory rather than persistent storage:
refreshing or explicitly logging out returns that screen to registration. Either
solo practice can be skipped, but the final duel is never skippable and starts
only when both connected stations are ready.
The dashboard retains the latest 500 backend/station events in memory. Use
`docker compose logs` for container logs.

Monkeytype and this derivative are licensed under GPL-3.0.
