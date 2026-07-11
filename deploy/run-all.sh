#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Orchestration « tout-en-un » du portail unifié Afriland.
#
# Lance, dans l'ordre, les trois briques du système — chacune depuis SON dépôt
# (donc avec son propre .env / build), sans les fusionner :
#   1. Backend promote   (Spring Boot + Postgres + MinIO)  -> :8390
#   2. Backend diaspora  (FastAPI)                          -> :10002
#   3. Gateway union     (Angular + nginx, sert les 3 fronts + proxy /*-api) -> :8080
#
# Les backends restent dans leurs dépôts respectifs ; on les référence par
# chemin (surchargable via PROMOTE_DIR / DIASPORA_DIR).
#
#   Usage :  bash deploy/run-all.sh
#   Arrêt :  bash deploy/stop-all.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"                     # union-portal/
PROMOTE_DIR="${PROMOTE_DIR:-$(cd "$ROOT/../../promoteApp" 2>/dev/null && pwd || true)}"
DIASPORA_DIR="${DIASPORA_DIR:-$(cd "$ROOT/../../diaspora-onboarding" 2>/dev/null && pwd || true)}"

echo "▶ 1/3  Backend promote (:8390)"
if [ -n "$PROMOTE_DIR" ] && [ -f "$PROMOTE_DIR/docker-compose.yml" ]; then
  docker compose -f "$PROMOTE_DIR/docker-compose.yml" \
                 -f "$ROOT/deploy/promote.ports.override.yml" up -d
else
  echo "  ⚠ promoteApp introuvable — définir PROMOTE_DIR=/chemin/vers/promoteApp"
fi

echo "▶ 2/3  Backend diaspora (:10002)"
if [ -n "$DIASPORA_DIR" ] && [ -f "$DIASPORA_DIR/docker-compose.yml" ]; then
  docker compose -f "$DIASPORA_DIR/docker-compose.yml" up -d
else
  echo "  ⚠ diaspora-onboarding introuvable — définir DIASPORA_DIR=/chemin/vers/diaspora-onboarding"
fi

echo "▶ 3/3  Gateway union (:8080)  — build front + image nginx"
cd "$ROOT"
npm run build:all
docker build -f Dockerfile.serve -t afriland-union:latest .
docker rm -f afriland-union >/dev/null 2>&1 || true
docker run -d --name afriland-union --restart unless-stopped \
  --add-host host.docker.internal:host-gateway -p 8080:80 afriland-union:latest

echo ""
echo "✅ Système en ligne :"
echo "   • Portail unifié : http://localhost:8080"
echo "   • Backend promote : http://localhost:8390/api"
echo "   • Backend diaspora: http://localhost:10002/api"
