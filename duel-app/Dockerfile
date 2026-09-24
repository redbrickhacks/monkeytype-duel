FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json ./
RUN corepack enable && pnpm install --frozen-lockfile=false
COPY . .
RUN pnpm build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3000 HOST=127.0.0.1 DATABASE_PATH=/data/duel.sqlite STATIC_DIR=/app/public
WORKDIR /app
COPY package.json ./
RUN corepack enable && pnpm install --prod --frozen-lockfile=false && pnpm store prune
COPY --from=build /app/dist-server ./dist-server
COPY --from=build /app/dist-web ./public
RUN mkdir -p /data
EXPOSE 3000
CMD ["node", "dist-server/server/index.js"]
