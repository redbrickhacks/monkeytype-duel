# Monkeytype Duel

A compact event-focused typing duel derived from Monkeytype. The Vite client is deployed to GitHub Pages; one Node process on the event VPS provides GitHub public-profile lookup, WebSocket race coordination, and SQLite-backed results.

## Development

```bash
pnpm install
pnpm --dir duel-app dev
```

Open `http://localhost:5173`. Use separate browser profiles or private windows for stations L and R, and `/#/spectate` for the spectator view.

## Production

Build the static client and server:

```bash
VITE_API_URL=https://api.keeb.makerspace.tools pnpm --dir duel-app build
```

The Pages artifact is `duel-app/dist-web`. The server entry point is `duel-app/dist-server/server/index.js`.

Runtime state is stored in one SQLite file configured by `DATABASE_PATH`. The server is deliberately single-instance; restarting during a race aborts that in-memory race while preserving completed results.

Monkeytype and this derivative are licensed under GPL-3.0.
