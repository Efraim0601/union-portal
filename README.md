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

## Prérequis

| Outil | Version | Notes |
|---|---|---|
| **Node.js** | **24.x** (≥ 20.19 accepté) | même version que l'image Docker (`node:24-alpine`) |
| **npm** | **11.x** (`packageManager: npm@11.11.0`) | `npm ci` exige un `package-lock.json` cohérent (cf. [Dépannage](#dépannage--pièges-connus)) |
| **Docker** + **docker compose** (plugin) | récent | pour le build/déploiement conteneurisé |
| **git** | — | le déploiement serveur clone 3 dépôts |

Le frontend ne fonctionne pas seul : il appelle **deux backends** (dépôts séparés) —
`promoteApp` (Spring Boot, `:8390`) et `diaspora-onboarding` (FastAPI, `:10002`).
Démarrez-les avant, ou utilisez l'[orchestration complète](#orchestration-complète-gateway--backends--une-commande).

## Lancer en dev

```bash
npm install
npm run serve:all            # host + 2 remotes en parallèle
# ou séparément :
npm run serve:promote        # :4201  (app complète, standalone)
npm run serve:diaspora       # :4202
npm run serve:shell          # :4200  (host ; démarrer les remotes d'abord)
```

Proxies backend (dev) — définis dans `projects/*/proxy.conf.js|json`, l'en-tête `Origin`
est retiré (même origine qu'en prod → évite le rejet CORS de Spring) :
- promote  `/promote-api/*` → `http://localhost:8390/api/*`  (réécriture `/promote-api`→`/api`)
- diaspora `/api/*` → `http://localhost:10002` (FastAPI `diaspora-onboarding`)

> **Caméra (selfie/CNI) en dev** : `getUserMedia` n'est autorisé que sur une **origine
> sécurisée**. En dev, `http://localhost:*` compte comme sûr → la caméra marche.
> Mais dès qu'on accède au front via une **IP/nom de machine en HTTP**, elle est bloquée
> (repli sur un placeholder). Voir [HTTPS & caméra](#https--caméra-kyc) pour la prod.

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
docker compose up --build        # -> http://localhost:8080  +  https://localhost:8443
# ou
docker build -t afriland-union . && docker run -p 8080:80 -p 8443:443 afriland-union
```

### Option B — build hors Docker puis empaqueter (rapide, réseau restreint)
```bash
npm run build:all
docker build -f Dockerfile.serve -t afriland-union .
docker run -p 8080:80 -p 8443:443 afriland-union     # http://localhost:8080  +  https://localhost:8443
```

> Le port **8443 (HTTPS)** est nécessaire à la caméra (KYC) ; certificat auto-signé généré au
> démarrage — cf. [HTTPS & caméra](#https--caméra-kyc).

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
| **Portail unifié** (nginx + 3 fronts) — HTTP | **6080** | `afriland-union` |
| **Portail unifié** — **HTTPS** (caméra/selfie) | **6443** | `afriland-union` |
| Backend promote (Spring Boot + Postgres + MinIO) | **6390** | `promoteapp-backend-1` |
| Backend diaspora (FastAPI) | **6002** | `diaspora-onboarding` |

- **Ports paramétrables** dans `deploy/server/.env` (`UNION_PORT`, `UNION_SSL_PORT`, `PROMOTE_PORT`,
  `DIASPORA_PORT`) ainsi que les URLs des dépôts et la branche.
- **HTTPS** est indispensable pour la caméra (KYC) — accès `https://<serveur>:6443` (cert auto-signé) ;
  voir [HTTPS & caméra](#https--caméra-kyc).
- **Paiement réel** : mettre `APP_PAYMENT_PROVIDER=trustpayway` + identifiants dans `promoteApp/.env` ;
  voir [Paiement TrustPayWay](#paiement-mobile-money-trustpayway).
- Le portail **proxifie** `/promote-api` → promote et `/api` → diaspora (même origine, pas de CORS).
  Les upstreams nginx sont **substitués au démarrage** (`PROMOTE_UPSTREAM`/`DIASPORA_UPSTREAM`,
  cf. `deploy/nginx.conf` en template envsubst) → une seule image pour tous les ports.
- Secrets : au 1ᵉʳ lancement, `promoteApp/.env` et `diaspora-onboarding/.env` sont créés depuis
  leurs `.env.example` — **éditez-les** (mots de passe, `JWT_SECRET`, `FERNET_KEY`) avant la prod.
- Arrêt : `bash deploy/server/stop.sh`.

> Le build du front se fait **dans Docker** (multi-stage `Dockerfile`) : le serveur n'a besoin
> que de Docker (pas de Node). Réseau npm restreint ? Basculez sur le build hôte (`npm run build:all`
> + `Dockerfile.serve`).

## HTTPS & caméra (KYC)

Les étapes selfie / photo CNI utilisent `navigator.mediaDevices.getUserMedia`, que les
navigateurs **n'autorisent que sur une origine sécurisée** (`https://` ou `http://localhost`).
Servi en **HTTP via une IP/domaine**, l'accès caméra est refusé et le composant retombe sur
un **placeholder** (`projects/promote/src/app/shared/photo-capture.ts`) — d'où l'impression de
« mode démo ». **Il faut donc servir le portail en HTTPS.**

Le gateway écoute déjà en **443** (`deploy/nginx.conf`) et un **certificat auto-signé** est
généré au démarrage du conteneur (`deploy/40-selfsigned-cert.sh`, exécuté par l'entrypoint nginx ;
`openssl` est installé dans l'image). Le port HTTPS est publié via **`UNION_SSL_PORT`** (défaut
**6443** serveur / **8443** en local).

```bash
# Accès HTTPS (accepter l'avertissement du cert auto-signé une seule fois) :
https://<serveur>:6443        # prod/test        (docker-compose local : https://localhost:8443)
```

> **Vraie prod** : remplacer le cert auto-signé par un certificat **Let's Encrypt** (vrai nom de
> domaine) — monter `union.crt`/`union.key` valides dans `/etc/nginx/ssl/` ou placer un reverse-proxy
> TLS (Caddy/Traefik) devant le gateway. Le script auto-signé ne sert qu'au dev/test.

## Paiement mobile money (TrustPayWay)

Le backend `promoteApp` intègre l'agrégateur **TrustPayWay** (Orange / MTN MoMo). Le parcours
front (souscription & recharge) déclenche le paiement puis **suit le statut en temps réel**
(polling de `…/status`) — plus aucun bouton de simulation.

**Sélection de la passerelle** (`app.payment.provider`, lu **au démarrage**) :

| Valeur | Effet |
|---|---|
| `simulated` (défaut) | passerelle factice — le paiement ne se règle que via `PATCH /subscriptions/{ref}/pay` (usage démo/staff). **Le suivi temps réel du front ne peut pas aboutir.** |
| `trustpayway` | vraie passerelle : push USSD réel + webhook + `get-status` + réconciliation. |

Pour activer le **paiement réel** (backend `promoteApp/.env`, puis **recréer** le conteneur) :

```bash
APP_PAYMENT_PROVIDER=trustpayway
# Identifiants : soit ici en env, soit via l'UI Admin → Paramètres → TrustPayWay (stockés en
# base, prioritaires sur l'env, pris en compte à chaud). Requis : base-url, secret-key, application-id.
TRUSTPAYWAY_BASE_URL=https://api.trustpayway.com
TRUSTPAYWAY_SECRET_KEY=…
TRUSTPAYWAY_APPLICATION_ID=…
TRUSTPAYWAY_NOTIF_URL=https://<domaine-public>/api/payment/webhook/trustpayway   # webhook joignable depuis Internet
```

```bash
docker compose -f promoteApp/docker-compose.yml -f /opt/afriland/.promote-ports.yml \
  up -d --force-recreate backend

# Vérifier la passerelle active :
curl -s http://localhost:6390/api/payment/provider      # -> {"provider":"trustpayway"}
```

Puis **Admin → Paramètres → TrustPayWay → Tester la connexion** (fait un vrai `POST /api/login`).
⚠️ Saisir les identifiants dans l'UI **ne suffit pas** à activer le paiement réel : le *provider*
n'est pas en base et ne bascule que par `APP_PAYMENT_PROVIDER` **+ redémarrage**. La réconciliation
automatique (`PAYMENT_RECONCILE=true`) rattrape les paiements dont le webhook n'arrive pas.

## Dépannage / pièges connus

- **`npm ci` échoue en `ERESOLVE` (build Docker du portail)** : `package-lock.json` incohérent
  (p. ex. `@angular/core` et `@angular/animations` sur des patchs différents — Angular exige
  l'alignement exact). Fix :
  ```bash
  rm package-lock.json && npm install --package-lock-only --no-audit --no-fund
  ```
  puis **commiter le lock** (sinon `deploy/server/deploy.sh` le réécrase depuis `origin/master`).
- **`deploy/server/deploy.sh` écrase les correctifs locaux** : il fait
  `git checkout -B master origin/master` → tout changement non **poussé** sur `origin/master`
  est perdu. Poussez avant de relancer, ou redéployez à la main (`docker build` + `docker run`).
- **Portail marqué `unhealthy` (cosmétique)** : le HEALTHCHECK `wget http://localhost/` résout en
  IPv6 `::1` alors que nginx écoute en IPv4 → toujours en échec bien que le portail serve du 200.
- **Backend promote en crash-loop `password authentication failed`** : le volume Postgres garde le
  mot de passe de sa **1ʳᵉ** init ; changer `.env` ne le met pas à jour. Corriger via
  `ALTER USER promote WITH PASSWORD '…'` (ou recréer le volume).
- **Caméra qui reste en placeholder** : origine non-HTTPS — cf. [HTTPS & caméra](#https--caméra-kyc).
- **Paiement bloqué « en cours » puis échec** : backend en `provider=simulated` — cf.
  [Paiement TrustPayWay](#paiement-mobile-money-trustpayway).

## Notes / TODO

- **Uniformité promote** : la police est alignée (Barlow) et les neutres sont proches
  de la banque ; l'adoption complète des composants `@union/design-system` dans les 17
  pages est progressive. Le rouge Afriland (`#C8102E`) est conservé en couleur de marque.
- **Navigation host-embarquée** : les remotes tournent parfaitement en standalone ; sous
  le host, les routes s'imbriquent (`/promote/…`, `/diaspora/…`). D'éventuels liens
  **absolus** internes de promote (`routerLink="/x"`) restent à passer en relatifs.
- **Polices** : chargées au runtime via `<link>` (inline build-time désactivé).
  Option : self-host Barlow/Inter pour un fonctionnement 100 % hors-ligne.
