#!/usr/bin/env bash
# Arrête le déploiement serveur (gateway + backends promote & diaspora).
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -f "$SCRIPT_DIR/.env" ] && { set -a; . "$SCRIPT_DIR/.env"; set +a; }
DEPLOY_DIR="${DEPLOY_DIR:-/opt/afriland}"

echo "■ Portail union"
docker rm -f afriland-union >/dev/null 2>&1 || true

echo "■ Backend diaspora"
docker compose -f "$DEPLOY_DIR/diaspora-onboarding/docker-compose.yml" \
  -f "$DEPLOY_DIR/.diaspora-ports.yml" down 2>/dev/null || true

echo "■ Backend promote"
docker compose -f "$DEPLOY_DIR/promoteApp/docker-compose.yml" \
  -f "$DEPLOY_DIR/.promote-ports.yml" down 2>/dev/null || true

echo "✅ Arrêté."
