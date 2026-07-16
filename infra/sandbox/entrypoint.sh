#!/usr/bin/env bash
set -euo pipefail

cd /workspace

if [[ -f package.json ]]; then
  if [[ ! -d node_modules ]]; then
    pnpm install --frozen-lockfile 2>/dev/null || pnpm install
  fi
  if grep -q '"dev"' package.json; then
    exec pnpm dev --port "${PORT}" --hostname 0.0.0.0
  elif grep -q '"start"' package.json; then
    pnpm build 2>/dev/null || true
    exec pnpm start --port "${PORT}" --hostname 0.0.0.0
  fi
fi

echo "Sandbox ready — no app server configured. Workspace mounted at /workspace."
exec tail -f /dev/null
