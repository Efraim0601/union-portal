# ============================================================================
# Afriland Union — image unique (gateway) servant shell + promote + diaspora
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
# Config gateway
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
# Shell (host) à la racine
COPY --from=build /app/dist/shell/browser/    /usr/share/nginx/html/
# Remotes sous /remotes/*
COPY --from=build /app/dist/promote/browser/  /usr/share/nginx/html/remotes/promote/
COPY --from=build /app/dist/diaspora/browser/ /usr/share/nginx/html/remotes/diaspora/
# Manifest de PROD (chemins same-origin) écrase celui de dev (localhost:*)
COPY deploy/federation.manifest.prod.json     /usr/share/nginx/html/federation.manifest.json

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://localhost/ >/dev/null 2>&1 || exit 1
CMD ["nginx", "-g", "daemon off;"]
