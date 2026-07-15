#!/usr/bin/env bash
# ============================================================================
# DÉPLOIEMENT CENTRALISÉ DE LA SOLUTION UNION
#
# Point d'entrée UNIQUE : ce script déploie toute la solution, pilotée par le
# manifeste `deploy/server/components.env` (dépôt, branche, chemin, port,
# service compose de chaque composant).
#
#   Portail union  (Angular + nginx : shell + promote + diaspora, 1 origine)
#   Backend promote (Spring Boot)      proxifié en /promote-api/*
#   Backend diaspora (FastAPI)         proxifié en /api/*
#   Payment Hub    (encaissement, mutualisé avec les autres applications)
#
# Pour chaque composant : git sync -> build image -> conteneur recréé sur la
# NOUVELLE image -> contrôle de santé.
#
# Usage :
#   bash deploy/server/deploy.sh                 # tout (ordre du manifeste)
#   bash deploy/server/deploy.sh promote union   # seulement ces composants
#   bash deploy/server/deploy.sh --no-sync       # sans git (déploie le code local)
#   bash deploy/server/deploy.sh --check         # ne déploie rien : état + santé
#
# Config locale (secrets, ports) : deploy/server/.env — chargé après le
# manifeste, il gagne. Prérequis : docker, docker compose, git, curl.
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

say()  { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓ %s\033[0m\n' "$*"; }
warn() { printf '  \033[33m⚠ %s\033[0m\n' "$*"; }
die()  { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# --- Manifeste (+ surcharge locale) ----------------------------------------
[ -f "$SCRIPT_DIR/components.env" ] || die "manifeste introuvable : $SCRIPT_DIR/components.env"
set -a
# shellcheck disable=SC1091
. "$SCRIPT_DIR/components.env"
[ -f "$SCRIPT_DIR/.env" ] && . "$SCRIPT_DIR/.env"
set +a

# --- Options / sélection des composants ------------------------------------
SYNC=1; CHECK_ONLY=0; SELECTED=""
for a in "$@"; do
  case "$a" in
    --no-sync) SYNC=0 ;;
    --check)   CHECK_ONLY=1 ;;
    -h|--help) sed -n '2,26p' "$0"; exit 0 ;;
    -*)        die "option inconnue : $a" ;;
    *)         SELECTED="$SELECTED $a" ;;
  esac
done
TARGETS="${SELECTED:-$COMPONENTS}"

# Accès aux variables du manifeste : var promote DIR -> $PROMOTE_DIR
var() { local n="${1^^}_$2"; printf '%s' "${!n:-}"; }

# --- Prérequis --------------------------------------------------------------
say "Prérequis"
command -v git    >/dev/null || die "git manquant"
command -v curl   >/dev/null || die "curl manquant"
command -v docker >/dev/null || die "docker manquant"
docker compose version >/dev/null 2>&1 || die "plugin 'docker compose' manquant"
docker info >/dev/null 2>&1 || die "docker inaccessible (service arrêté ? droits ?)"
ok "docker $(docker --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1) / compose $(docker compose version --short)"
ok "composants ciblés :$(printf ' %s' $TARGETS)"

# ---------------------------------------------------------------------------
# 1. Synchronisation git
#    fetch avec refspec EXPLICITE (sinon origin/<branche> n'est pas créée et le
#    checkout échoue) puis merge --ff-only : jamais de reset destructif, on
#    échoue bruyamment si l'historique local a divergé.
# ---------------------------------------------------------------------------
sync_repo() {
  local name="$1" dir repo branch
  dir="$(var "$name" DIR)"; repo="$(var "$name" REPO)"; branch="$(var "$name" BRANCH)"

  if [ ! -d "$dir/.git" ]; then
    say "git $name : clonage de $repo ($branch)"
    git clone -b "$branch" "$repo" "$dir" || die "clonage de $name impossible"
    ok "$name cloné"
    return
  fi

  if [ -n "$(git -C "$dir" status --porcelain --untracked-files=no)" ]; then
    warn "$name : modifications locales non commitées -> sync git ignorée (le code local sera déployé tel quel)"
    return
  fi

  git -C "$dir" fetch -q origin "$branch:refs/remotes/origin/$branch" 2>/dev/null \
    || git -C "$dir" fetch -q origin "$branch" \
    || { warn "$name : fetch impossible (remote injoignable) — code local conservé"; return; }

  git -C "$dir" checkout -q "$branch" 2>/dev/null || git -C "$dir" checkout -q -B "$branch" "origin/$branch"
  if git -C "$dir" merge --ff-only -q "origin/$branch" 2>/dev/null; then
    ok "$name @ $branch -> $(git -C "$dir" log -1 --format='%h %s' | cut -c1-60)"
  else
    warn "$name : l'historique local a divergé de origin/$branch — sync ignorée (résolvez à la main)"
  fi
}

# ---------------------------------------------------------------------------
# 2. Override de ports : les compose de promote/diaspora ne publient pas (ou pas
#    sur le bon port) leur backend. On génère l'override à côté du compose.
# ---------------------------------------------------------------------------
ports_override() {
  local name="$1" dir svc host_port target_port file
  dir="$(var "$name" DIR)"; svc="$(var "$name" SERVICE)"
  host_port="$(var "$name" PORT)"; target_port="$(var "$name" TARGET_PORT)"
  [ -n "$host_port" ] && [ -n "$target_port" ] || return 0   # composant sans remap

  file="$dir/.ports.override.yml"
  cat > "$file" <<YML
# Généré par deploy/server/deploy.sh — publie le service sur le port hôte du
# manifeste. NE PAS éditer à la main (régénéré à chaque déploiement).
services:
  $svc:
    ports: !override
      - "${host_port}:${target_port}"
YML
  printf '%s' "$file"
}

# ---------------------------------------------------------------------------
# 3. Déploiement d'un composant : build -> recréation FORCÉE -> contrôle image
#    --force-recreate est indispensable : sans lui, `up -d --build` construit la
#    nouvelle image mais laisse le conteneur tourner sur l'ANCIENNE.
# ---------------------------------------------------------------------------
deploy_component() {
  local name="$1" dir compose svc container files override img_tag img_running
  dir="$(var "$name" DIR)"; compose="$(var "$name" COMPOSE)"
  svc="$(var "$name" SERVICE)"; container="$(var "$name" CONTAINER)"

  [ -f "$dir/$compose" ] || die "$name : compose introuvable ($dir/$compose)"

  say "Déploiement $name (service '$svc')"
  files=(-f "$dir/$compose")
  override="$(ports_override "$name")"
  [ -n "$override" ] && files+=(-f "$override")

  # Le portail a pu être lancé jadis par `docker run` (hors compose) : compose
  # refuserait de réutiliser ce nom. On retire le conteneur hérité.
  if docker inspect "$container" >/dev/null 2>&1 \
     && [ -z "$(docker inspect "$container" --format '{{index .Config.Labels "com.docker.compose.project"}}')" ]; then
    warn "$container : conteneur hérité (hors compose) -> supprimé pour reprise en main par compose"
    docker rm -f "$container" >/dev/null
  fi

  # Build + run dans un log : en cas d'échec (compilation cassée, dépendance
  # manquante…), on montre l'erreur RÉELLE au lieu de la noyer.
  local log; log="$(mktemp)"
  if ! docker compose "${files[@]}" up -d --build --force-recreate "$svc" >"$log" 2>&1; then
    warn "$name : ÉCHEC du build/démarrage — extrait de l'erreur :"
    grep -Ei 'error|failed to solve|exception|cannot find symbol' "$log" | tail -6 | sed 's/^/      /'
    warn "$name : log complet -> $log  (le conteneur en place n'a PAS été touché)"
    return 1
  fi
  rm -f "$log"

  # Le conteneur tourne-t-il bien sur l'image qu'on vient de construire ?
  img_tag="$(docker compose "${files[@]}" images -q "$svc" 2>/dev/null | head -1)"
  img_running="$(docker inspect "$container" --format '{{.Image}}' 2>/dev/null || true)"
  if [ -n "$img_tag" ] && [ -n "$img_running" ] && [ "${img_tag:0:12}" != "${img_running#sha256:}" ] \
     && [ "${img_tag#sha256:}" != "${img_running#sha256:}" ]; then
    warn "$name : le conteneur ne tourne PAS sur l'image fraîche ($img_running ≠ $img_tag)"
  else
    ok "$name recréé sur l'image fraîche"
  fi
}

# ---------------------------------------------------------------------------
# 4. Contrôles de santé
# ---------------------------------------------------------------------------
probe() {  # <libellé> <url> [attendu=200]
  local label="$1" url="$2" want="${3:-200}" code
  code=$(curl -sk -o /dev/null -w '%{http_code}' --max-time 10 "$url" || echo 000)
  if [ "$code" = "$want" ]; then ok "$label -> $code"; else warn "$label -> $code (attendu $want)"; fi
}

wait_healthy() {  # <libellé> <url> : les backends Spring/FastAPI mettent ~30 s
  local label="$1" url="$2" i
  for i in $(seq 1 30); do
    [ "$(curl -sk -o /dev/null -w '%{http_code}' --max-time 5 "$url" || echo 000)" = 200 ] && { ok "$label prêt"; return; }
    sleep 3
  done
  warn "$label toujours pas prêt après 90 s — voir : docker logs --tail 50 <conteneur>"
}

verify_all() {
  say "Vérification de la solution"
  wait_healthy "backend promote"  "$PROMOTE_HEALTH"
  wait_healthy "backend diaspora" "$DIASPORA_HEALTH"
  probe "payment hub  $HUB_HEALTH" "$HUB_HEALTH"
  probe "portail HTTP  :$UNION_PORT"     "http://localhost:${UNION_PORT}/"
  probe "portail HTTPS :$UNION_SSL_PORT" "https://localhost:${UNION_SSL_PORT}/"

  # Proxy même origine : c'est ce que le navigateur emprunte réellement.
  probe "proxy promote  /promote-api/products" "http://localhost:${UNION_PORT}/promote-api/products"
  # ⚠ diaspora force HTTPS (redirection 308 si X-Forwarded-Proto=http) : on
  #   sonde donc son API via le portail HTTPS, pas HTTP.
  probe "proxy diaspora /api/* (via HTTPS)" \
        "https://localhost:${UNION_SSL_PORT}${DIASPORA_PROXY_PROBE:-/api/backoffice/mastercard/config-status}"
  # Back-office diaspora (pages server-rendered) exposé via le gateway : la page de
  #   login doit répondre à travers le proxy (et non retomber sur le shell Angular).
  probe "proxy back-office /backoffice/login (via HTTPS)" \
        "https://localhost:${UNION_SSL_PORT}/backoffice/login"

  # Le paiement doit bien passer par le Hub (et non un provider simulé).
  local prov
  prov=$(curl -s --max-time 5 "http://localhost:${PROMOTE_PORT}/api/payment/provider" 2>/dev/null || true)
  case "$prov" in
    *paymenthub*) ok "provider de paiement -> paymenthub" ;;
    *)            warn "provider de paiement inattendu : ${prov:-<vide>} (attendu paymenthub)" ;;
  esac
}

# ---------------------------------------------------------------------------
# Exécution
# ---------------------------------------------------------------------------
if [ "$CHECK_ONLY" = 1 ]; then
  say "État des conteneurs"
  for c in $TARGETS; do
    printf '  %-10s %s\n' "$c" "$(docker ps --filter "name=^$(var "$c" CONTAINER)$" --format '{{.Status}}  {{.Ports}}' || echo 'arrêté')"
  done
  verify_all
  exit 0
fi

# Un composant en échec ne doit PAS bloquer les autres : on isole, on continue,
# et on récapitule à la fin (le composant en échec garde son conteneur en place).
FAILED=""
for c in $TARGETS; do
  [ "$SYNC" = 1 ] && sync_repo "$c"
  deploy_component "$c" || FAILED="$FAILED $c"
done

verify_all

if [ -n "$FAILED" ]; then
  printf '\n\033[31m✗ Composants en échec :%s\033[0m\n' "$FAILED" >&2
  printf '  Les autres composants sont déployés ; ceux-ci tournent encore sur leur ANCIENNE image.\n' >&2
  exit 1
fi

cat <<EOF

$(printf '\033[1;32m✅ Solution déployée.\033[0m')
   • Portail (HTTPS, à utiliser)  : https://<serveur>:${UNION_SSL_PORT}
     ↳ requis pour la caméra/selfie ET pour l'API diaspora (elle force HTTPS).
     ↳ certificat auto-signé : accepter l'avertissement du navigateur une fois.
   • Portail (HTTP)               : http://<serveur>:${UNION_PORT}
   • Backend promote              : http://<serveur>:${PROMOTE_PORT}/api
   • Backend diaspora             : http://<serveur>:${DIASPORA_PORT}/api
   • Payment Hub                  : ${HUB_HEALTH%/actuator/health}

   Santé : bash deploy/server/deploy.sh --check
   Arrêt : bash deploy/server/stop.sh
   Logs  : docker logs -f ${UNION_CONTAINER}
EOF
