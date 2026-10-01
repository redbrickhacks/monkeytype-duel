#!/usr/bin/env bash
set -euo pipefail

target="${DEPLOY_TARGET:-kb-local}"
remote_dir="${DEPLOY_DIR:-/opt/monkeytype-duel}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
app_dir="$(cd "${script_dir}/.." && pwd)"

ssh "${target}" "mkdir -p '${remote_dir}/current/data' && chown 1000:1000 '${remote_dir}/current/data' && chmod 700 '${remote_dir}/current/data'"
rsync -az --delete \
  --exclude '/.env' \
  --exclude '/data/' \
  --exclude '/dist-server/' \
  --exclude '/dist-web/' \
  --exclude '/node_modules/' \
  --exclude '/playwright-report/' \
  --exclude '/test-results/' \
  "${app_dir}/" "${target}:${remote_dir}/current/"

ssh "${target}" "cd '${remote_dir}/current' && test -f .env && docker compose build --pull && docker compose up -d --remove-orphans --wait --wait-timeout 60 && docker compose ps"
