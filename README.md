# Afriland Union — Monorepo frontend

Monorepo **Angular CLI 21** reproduisant l'architecture de `portal-client-firstpay`
(host + remotes via **module federation**), avec un **design-system uniforme** aligné
sur la banque et une **session client partagée** (SSO).

## Architecture

```
shell (host, :4200)  ──loadRemoteModule──►  promote  (remote, :4201)  expose ./Routes
                                            diaspora (remote, :4202)  expose ./Routes

libs partagées :  @union/design-system   (tokens shadcn banque + Tailwind v4 + composants)
                  @union/auth            (ClientAuthStore, clé localStorage portail_client_auth)
```

- **Fédération** : [`@angular-architects/native-federation`](https://www.npmjs.com/package/@angular-architects/native-federation) (équivalent esbuild du Module Federation de la banque).
- **Design-system** : tokens CSS **identiques** à `apps/host/src/pages/styles.css` de la banque
  (thème « neutral » shadcn), Tailwind v4 (`.postcssrc.json`), polices Barlow/Inter.
- **SSO** : `@union/auth` partage la clé localStorage `portail_client_auth` (JWT, sync cross-tab)
  → interopérable avec les apps de la banque servies sur la même origine.

## Projets (`projects/`)

| Projet | Type | Port | Contenu |
|--------|------|------|---------|
| `shell` | host | 4200 | Coquille + navigation, charge les remotes |
| `promote` | remote | 4201 | App staff (17 pages migrées de `promoteApp/frontend`) |
| `diaspora` | remote | 4202 | Ouverture de compte diaspora (onboarding 5 étapes) |
| `design-system` | lib | — | `@union/design-system` (path-mappée) |
| `auth` | lib | — | `@union/auth` (path-mappée) |

## Lancer en dev

```bash
npm install
npm run serve:all            # host + 2 remotes en parallèle
# ou séparément :
npm run serve:promote        # :4201  (app complète, standalone)
npm run serve:diaspora       # :4202
npm run serve:shell          # :4200  (host ; démarrer les remotes d'abord)
```

Proxies backend (dev) :
- promote  `/api` → `http://localhost:8390`
- diaspora `/api` → `http://localhost:10002` (FastAPI `diaspora-onboarding`)

## Build

```bash
npm run build:all            # shell + promote + diaspora
```

## Déploiement Docker (facile — une seule image, une seule origine)

Le portail se déploie en **une image nginx** servant `shell` + `promote` + `diaspora`
sur la **même origine** (`/`, `/remotes/promote/`, `/remotes/diaspora/`). Même origine
⇒ `localStorage 'portail_client_auth'` **partagé** (SSO / communication inter-apps) et
**aucun CORS**. Les routes client `/promote` et `/diaspora` du shell ne collisionnent pas
avec les assets statiques (servis sous `/remotes/…`).

### Option A — build tout-en-un dans Docker (serveur avec réseau)
```bash
docker compose up --build        # -> http://localhost:8080
# ou
docker build -t afriland-union . && docker run -p 8080:80 afriland-union
```

### Option B — build hors Docker puis empaqueter (rapide, réseau restreint)
```bash
npm run build:all
docker build -f Dockerfile.serve -t afriland-union .
docker run -p 8080:80 afriland-union     # -> http://localhost:8080
```

### Vérifié (image nginx réelle)
| Endpoint | Attendu |
|---|---|
| `GET /` | 200 — shell |
| `GET /federation.manifest.json` | 200 — `{promote:/remotes/promote/remoteEntry.json, …}` |
| `GET /remotes/promote/remoteEntry.json` | 200 application/json |
| `GET /remotes/diaspora/remoteEntry.json` | 200 application/json |
| `GET /remotes/promote/<chunk>.js` | 200 application/javascript |
| `GET /promote` | 200 — sert le **shell** (route client, pas de collision) |

> **API backend** : le frontend appelle `/api`. En prod, ajoute un `location /api { proxy_pass … }`
> dans `deploy/nginx.conf` vers tes backends (promote `:8390`, diaspora FastAPI `:10002`),
> ou branche-les via un réseau docker-compose.

Fichiers de déploiement : `Dockerfile` (build+serve), `Dockerfile.serve` (serve seul),
`docker-compose.yml`, `deploy/nginx.conf` (gateway), `deploy/federation.manifest.prod.json`.

## Orchestration complète (gateway + backends) — une commande

Le portail parle à **deux backends** vivant dans leurs propres dépôts :
`promoteApp` (Spring Boot, staff/ventes/stats) et `diaspora-onboarding` (FastAPI).
Ils **restent séparés** (équipes, stacks, `.env` distincts) ; on les orchestre sans les
fusionner via un script qui lance chaque brique depuis son dossier :

```bash
bash deploy/run-all.sh        # backend promote + backend diaspora + gateway union
bash deploy/stop-all.sh       # tout arrêter
```

Chemins des backends surchargeables : `PROMOTE_DIR=… DIASPORA_DIR=… bash deploy/run-all.sh`
(par défaut `../../promoteApp` et `../../diaspora-onboarding`).

**Câblage API** (proxy dans `deploy/nginx.conf`, origine unique — pas de CORS) :

| Front appelle | Proxifié vers | Backend |
|---|---|---|
| `/promote-api/*` | `host.docker.internal:8390/api/*` | promote (JWT, rôles, ventes, stats) |
| `/api/*` | `host.docker.internal:10002/api/*` | diaspora (onboarding) |

- Le backend promote n'est pas publié par défaut → `deploy/promote.ports.override.yml`
  publie `:8390` sur l'hôte (le gateway le joint via `host.docker.internal`).
- **CORS** : l'en-tête `Origin` est neutralisé côté proxy (même origine) — sinon Spring
  rejette (« Invalid CORS request »). Idem en dev (`proxy.conf.js`, `removeHeader('origin')`).
- **Connexion staff** : hub → « Espace collaborateur » → login → redirection par rôle
  (`/promote/admin|manager|supervision|dashboard|cashier|print`). Comptes seedés dans
  `promoteApp/.env`.

> **Pourquoi pas un mono-repo unique ?** Les backends et le design-system
> (`portal-client-firstpay`, partagé par d'autres apps) ont des propriétaires, stacks et
> cycles différents, et sont intégrés par **contrat HTTP** stable. On garde donc les dépôts
> séparés + cette fine couche d'orchestration.

## Déploiement sur serveur Ubuntu (depuis GitHub, ports 6000-7000)

Un script récupère les **3 dépôts** GitHub et déploie tout le système en conteneurs,
avec des ports hôte dans la plage **6000-7000** :

```bash
# sur le serveur (prérequis : docker, docker compose, git) :
git clone https://github.com/Efraim0601/union-portal.git
cd union-portal
cp deploy/server/.env.example deploy/server/.env   # (optionnel) ajuster ports / URLs / secrets
bash deploy/server/deploy.sh                        # clone les 3 repos + build + run
```

| Service | Port hôte (défaut) | Conteneur |
|---|---|---|
| **Portail unifié** (nginx + 3 fronts) | **6080** | `afriland-union` |
| Backend promote (Spring Boot + Postgres + MinIO) | **6390** | `promoteapp-backend-1` |
| Backend diaspora (FastAPI) | **6002** | `diaspora-onboarding` |

- **Ports paramétrables** dans `deploy/server/.env` (`UNION_PORT`, `PROMOTE_PORT`, `DIASPORA_PORT`)
  ainsi que les URLs des dépôts et la branche.
- Le portail **proxifie** `/promote-api` → promote et `/api` → diaspora (même origine, pas de CORS).
  Les upstreams nginx sont **substitués au démarrage** (`PROMOTE_UPSTREAM`/`DIASPORA_UPSTREAM`,
  cf. `deploy/nginx.conf` en template envsubst) → une seule image pour tous les ports.
- Secrets : au 1ᵉʳ lancement, `promoteApp/.env` et `diaspora-onboarding/.env` sont créés depuis
  leurs `.env.example` — **éditez-les** (mots de passe, `JWT_SECRET`, `FERNET_KEY`) avant la prod.
- Arrêt : `bash deploy/server/stop.sh`.

> Le build du front se fait **dans Docker** (multi-stage `Dockerfile`) : le serveur n'a besoin
> que de Docker (pas de Node). Réseau npm restreint ? Basculez sur le build hôte (`npm run build:all`
> + `Dockerfile.serve`).

## Notes / TODO

- **Uniformité promote** : la police est alignée (Barlow) et les neutres sont proches
  de la banque ; l'adoption complète des composants `@union/design-system` dans les 17
  pages est progressive. Le rouge Afriland (`#C8102E`) est conservé en couleur de marque.
- **Navigation host-embarquée** : les remotes tournent parfaitement en standalone ; sous
  le host, les routes s'imbriquent (`/promote/…`, `/diaspora/…`). D'éventuels liens
  **absolus** internes de promote (`routerLink="/x"`) restent à passer en relatifs.
- **Polices** : chargées au runtime via `<link>` (inline build-time désactivé).
  Option : self-host Barlow/Inter pour un fonctionnement 100 % hors-ligne.
