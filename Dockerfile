# ============================================================================
# Afriland Onboarding — image unique (gateway) servant shell + promote + diaspora
# Architecture host/remotes (Native Federation), une seule origine (SSO partagé).
# Build :   docker build -t afriland-union .
# Run   :   docker run -p 8080:80 afriland-union   ->  http://localhost:8080
# ============================================================================

# ---------- Stage 1 : build des 3 apps ----------
FROM node:24-alpine AS build
WORKDIR /app

# Dépendances (couche cache tant que package*.json ne change pas)
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Sources
COPY . .

# Build prod avec base-href alignés sur les chemins de service
RUN node node_modules/.bin/ng build shell    --base-href / \
 && node node_modules/.bin/ng build promote  --base-href /remotes/promote/ \
 && node node_modules/.bin/ng build diaspora --base-href /remotes/diaspora/

# ---------- Stage 2 : nginx ----------
FROM nginx:1.27-alpine
# Config gateway en TEMPLATE : les upstreams backend sont substitués au démarrage
# (envsubst de l'image nginx) depuis PROMOTE_UPSTREAM / DIASPORA_UPSTREAM.
# Défauts = backends sur l'hôte (host.docker.internal) ; surchargés au `docker run -e`.
ENV PROMOTE_UPSTREAM=host.docker.internal:8390
ENV DIASPORA_UPSTREAM=host.docker.internal:10002
# openssl : requis pour générer le certificat TLS auto-signé au démarrage.
RUN apk add --no-cache openssl
COPY deploy/nginx.conf /etc/nginx/templates/default.conf.template
# Génère le certificat auto-signé avant le lancement de nginx (HTTPS/caméra).
COPY deploy/40-selfsigned-cert.sh /docker-entrypoint.d/40-selfsigned-cert.sh
RUN chmod +x /docker-entrypoint.d/40-selfsigned-cert.sh
# Shell (host) à la racine
COPY --from=build /app/dist/shell/browser/    /usr/share/nginx/html/
# Remotes sous /remotes/*
COPY --from=build /app/dist/promote/browser/  /usr/share/nginx/html/remotes/promote/
COPY --from=build /app/dist/diaspora/browser/ /usr/share/nginx/html/remotes/diaspora/
# Manifest de PROD (chemins same-origin) écrase celui de dev (localhost:*)
COPY deploy/federation.manifest.prod.json     /usr/share/nginx/html/federation.manifest.json

EXPOSE 80 443
# 127.0.0.1 explicite : « localhost » résout en IPv6 (::1) dans l'image, alors
# que nginx n'écoute qu'en IPv4 -> le healthcheck échouait en permanence.
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1
CMD ["nginx", "-g", "daemon off;"]
