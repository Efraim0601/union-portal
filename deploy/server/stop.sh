#!/usr/bin/env bash
# ============================================================================
# Arrêt de la solution union — piloté par le même manifeste que deploy.sh.
#
#   bash deploy/server/stop.sh              # arrête tout (sauf le Hub, mutualisé)
#   bash deploy/server/stop.sh union        # un composant précis
#   bash deploy/server/stop.sh hub          # le Hub, explicitement (voir ⚠)
#
# ⚠ Le Payment Hub sert AUSSI les autres applications de la machine : il n'est
#   jamais arrêté par défaut, il faut le nommer explicitement.
# ============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
set -a
# shellcheck disable=SC1091
. "$SCRIPT_DIR/components.env"
[ -f "$SCRIPT_DIR/.env" ] && . "$SCRIPT_DIR/.env"
set +a

var() { local n="${1^^}_$2"; printf '%s' "${!n:-}"; }

# Par défaut : tout sauf le Hub (mutualisé avec les autres applications).
TARGETS="${*:-$(echo "$COMPONENTS" | tr ' ' '\n' | grep -v '^hub$' | tr '\n' ' ')}"

for c in $TARGETS; do
  dir="$(var "$c" DIR)"; compose="$(var "$c" COMPOSE)"; svc="$(var "$c" SERVICE)"
  [ -f "$dir/$compose" ] || { echo "  ⚠ $c : compose introuvable, ignoré"; continue; }

  files=(-f "$dir/$compose")
  [ -f "$dir/.ports.override.yml" ] && files+=(-f "$dir/.ports.override.yml")

  echo "■ $c ($svc)"
  docker compose "${files[@]}" stop "$svc" >/dev/null 2>&1 || true
done

echo "✅ Arrêté :$(printf ' %s' $TARGETS)"
echo "   Relance : bash deploy/server/deploy.sh"
