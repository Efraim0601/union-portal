#!/usr/bin/env bash
# Arrête les trois briques lancées par run-all.sh (backends + gateway union).
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROMOTE_DIR="${PROMOTE_DIR:-$(cd "$ROOT/../../promoteApp" 2>/dev/null && pwd || true)}"
DIASPORA_DIR="${DIASPORA_DIR:-$(cd "$ROOT/../../diaspora-onboarding" 2>/dev/null && pwd || true)}"

echo "■ Gateway union"
docker rm -f afriland-union >/dev/null 2>&1 || true

echo "■ Backend diaspora"
[ -n "$DIASPORA_DIR" ] && docker compose -f "$DIASPORA_DIR/docker-compose.yml" down || true

echo "■ Backend promote"
[ -n "$PROMOTE_DIR" ] && docker compose -f "$PROMOTE_DIR/docker-compose.yml" \
  -f "$ROOT/deploy/promote.ports.override.yml" down || true

echo "✅ Arrêté."
