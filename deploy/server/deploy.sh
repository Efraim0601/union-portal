#!/usr/bin/env bash
# ============================================================================
# Déploiement serveur (Ubuntu) du portail unifié Afriland.
#
# Récupère les 3 dépôts GitHub, puis déploie tout le système en conteneurs,
# avec des ports hôte dans la plage 6000-7000 :
#   • Portail unifié (nginx + 3 fronts)   -> http://SERVEUR:${UNION_PORT}
#   • Backend promote (Spring Boot + DB)  -> :${PROMOTE_PORT}
#   • Backend diaspora (FastAPI)          -> :${DIASPORA_PORT}
#
# Le portail (nginx) proxifie /promote-api -> promote et /api -> diaspora en
# même origine (pas de CORS). Les upstreams pointent vers les ports hôte via
# host.docker.internal (envsubst du template nginx au démarrage).
#
# Usage :
#   # 1) config (optionnel — sinon valeurs par défaut) :
#   cp deploy/server/.env.example deploy/server/.env && nano deploy/server/.env
#   # 2) déploiement :
#   bash deploy/server/deploy.sh
#
# Prérequis serveur : docker, docker compose (plugin), git, curl.
# ============================================================================
set -euo pipefail

# --- Localisation du script / chargement de la config -----------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -f "$SCRIPT_DIR/.env" ] && { set -a; . "$SCRIPT_DIR/.env"; set +a; }

# Valeurs par défaut (surchargées par deploy/server/.env ou l'environnement)
UNION_PORT="${UNION_PORT:-6080}"
UNION_SSL_PORT="${UNION_SSL_PORT:-6443}"
PROMOTE_PORT="${PROMOTE_PORT:-6390}"
DIASPORA_PORT="${DIASPORA_PORT:-6002}"
UNION_REPO="${UNION_REPO:-https://github.com/Efraim0601/union-portal.git}"
PROMOTE_REPO="${PROMOTE_REPO:-https://github.com/Efraim0601/promoteApp.git}"
DIASPORA_REPO="${DIASPORA_REPO:-https://github.com/Kholia-1/diaspora-onboarding.git}"
GIT_BRANCH="${GIT_BRANCH:-master}"
PROMOTE_BRANCH="${PROMOTE_BRANCH:-$GIT_BRANCH}"
DIASPORA_BRANCH="${DIASPORA_BRANCH:-$GIT_BRANCH}"
UNION_BRANCH="${UNION_BRANCH:-$GIT_BRANCH}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/afriland}"

say()  { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓ %s\033[0m\n' "$*"; }
warn() { printf '  \033[33m⚠ %s\033[0m\n' "$*"; }
die()  { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# --- 1. Prérequis -----------------------------------------------------------
say "1/6  Vérification des prérequis"
command -v git >/dev/null   || die "git manquant   -> sudo apt-get update && sudo apt-get install -y git"
command -v docker >/dev/null || die "docker manquant -> https://docs.docker.com/engine/install/ubuntu/"
docker compose version >/dev/null 2>&1 || die "plugin 'docker compose' manquant -> sudo apt-get install -y docker-compose-plugin"
docker info >/dev/null 2>&1 || die "docker inaccessible (démarrez le service ou ajoutez l'utilisateur au groupe docker)"
ok "docker $(docker --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1), compose $(docker compose version --short)"

mkdir -p "$DEPLOY_DIR"

# --- 2. Récupération des 3 dépôts ------------------------------------------
say "2/6  Récupération des dépôts GitHub dans $DEPLOY_DIR"
# Branche par défaut d'un dépôt distant (ex. master / main)
remote_default_branch() { git ls-remote --symref "$1" HEAD 2>/dev/null | awk '/^ref:/{sub("refs/heads/","",$2); print $2; exit}'; }
clone_or_pull() {  # <url> <dir> <branch souhaitée>
  local url="$1" dir="$2" branch="$3"
  # Si la branche demandée n'existe pas sur le remote, on retombe sur sa branche par défaut
  # (union-portal & promoteApp = master ; diaspora-onboarding = main).
  if ! git ls-remote --exit-code --heads "$url" "$branch" >/dev/null 2>&1; then
    local def; def="$(remote_default_branch "$url")"
    [ -n "$def" ] && { warn "branche '$branch' absente sur $(basename "$dir") -> utilisation de '$def'"; branch="$def"; }
  fi
  if [ -d "$dir/.git" ]; then
    git -C "$dir" fetch --depth 1 origin "$branch" && git -C "$dir" checkout -q -B "$branch" "origin/$branch"
    ok "maj $(basename "$dir") ($branch)"
  else
    rm -rf "$dir"
    git clone --depth 1 -b "$branch" "$url" "$dir"
    ok "cloné $(basename "$dir") ($branch)"
  fi
}
clone_or_pull "$UNION_REPO"    "$DEPLOY_DIR/union-portal"        "$UNION_BRANCH"
clone_or_pull "$PROMOTE_REPO"  "$DEPLOY_DIR/promoteApp"          "$PROMOTE_BRANCH"
clone_or_pull "$DIASPORA_REPO" "$DEPLOY_DIR/diaspora-onboarding" "$DIASPORA_BRANCH"

UNION="$DEPLOY_DIR/union-portal"
PROMOTE="$DEPLOY_DIR/promoteApp"
DIASPORA="$DEPLOY_DIR/diaspora-onboarding"

# --- 3. Secrets (.env des backends) ----------------------------------------
say "3/6  Fichiers d'environnement des backends"
ensure_env() {  # <dir>
  if [ ! -f "$1/.env" ] && [ -f "$1/.env.example" ]; then
    cp "$1/.env.example" "$1/.env"
    warn "$(basename "$1")/.env créé depuis .env.example — ÉDITEZ les secrets (mots de passe, JWT_SECRET, FERNET_KEY…) pour la prod"
  else
    ok "$(basename "$1")/.env présent"
  fi
}
ensure_env "$PROMOTE"
ensure_env "$DIASPORA"

# --- 4. Backend promote (publie ${PROMOTE_PORT}) ---------------------------
say "4/6  Backend promote (:$PROMOTE_PORT)"
cat > "$DEPLOY_DIR/.promote-ports.yml" <<YML
services:
  backend:
    ports:
      - "${PROMOTE_PORT}:8390"
YML
docker compose -f "$PROMOTE/docker-compose.yml" -f "$DEPLOY_DIR/.promote-ports.yml" up -d --build
ok "promote démarré"

# --- 5. Backend diaspora (remappe le port sur ${DIASPORA_PORT}) ------------
say "5/6  Backend diaspora (:$DIASPORA_PORT)"
# !override remplace la liste de ports du compose de base (10002:8010 -> DIASPORA_PORT:8010)
cat > "$DEPLOY_DIR/.diaspora-ports.yml" <<YML
services:
  diaspora-onboarding:
    ports: !override
      - "${DIASPORA_PORT}:8010"
YML
docker compose -f "$DIASPORA/docker-compose.yml" -f "$DEPLOY_DIR/.diaspora-ports.yml" up -d --build
ok "diaspora démarré"

# --- 6. Gateway union (build front dans Docker + run) ----------------------
say "6/6  Portail unifié (:$UNION_PORT)"
docker build -t afriland-union:latest "$UNION"
docker rm -f afriland-union >/dev/null 2>&1 || true
docker run -d --name afriland-union --restart unless-stopped \
  --add-host host.docker.internal:host-gateway \
  -e PROMOTE_UPSTREAM="host.docker.internal:${PROMOTE_PORT}" \
  -e DIASPORA_UPSTREAM="host.docker.internal:${DIASPORA_PORT}" \
  -p "${UNION_PORT}:80" -p "${UNION_SSL_PORT}:443" afriland-union:latest
ok "gateway démarré"

# --- Vérification -----------------------------------------------------------
say "Vérification"
sleep 4
code_union=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:${UNION_PORT}/" || echo 000)
code_api=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:${UNION_PORT}/promote-api/products" || echo 000)
[ "$code_union" = 200 ] && ok "portail HTTP $code_union" || warn "portail HTTP $code_union"
[ "$code_api" = 200 ] && ok "proxy promote HTTP $code_api" || warn "proxy promote HTTP $code_api (le backend Spring peut mettre ~30 s à démarrer)"

cat <<EOF

\033[1;32m✅ Déploiement terminé.\033[0m
   • Portail unifié  : http://<serveur>:${UNION_PORT}
   • Portail (HTTPS) : https://<serveur>:${UNION_SSL_PORT}   ← à utiliser pour la caméra/selfie
                       (certificat auto-signé : accepter l'avertissement du navigateur une fois)
   • Backend promote : http://<serveur>:${PROMOTE_PORT}/api
   • Backend diaspora: http://<serveur>:${DIASPORA_PORT}/api

   Arrêt : bash deploy/server/stop.sh
   Logs  : docker logs -f afriland-union   |   docker compose -f $PROMOTE/docker-compose.yml logs -f backend
EOF
