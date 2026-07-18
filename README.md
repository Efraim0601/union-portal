# Afriland Onboarding — Monorepo frontend

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

### Le portail seul (sans les backends)
```bash
docker compose up --build -d     # -> http://localhost:6080  +  https://localhost:6443
```

> Pour déployer la **solution complète** (portail + promote + diaspora + payment hub),
> n'utilisez pas ce compose directement : passez par le point d'entrée unique
> [`deploy/server/deploy.sh`](#déploiement-centralisé-une-seule-commande).

> Le port **HTTPS (6443)** est nécessaire à la caméra (KYC) **et à l'API diaspora**
> (elle force HTTPS) ; certificat auto-signé généré au démarrage — cf.
> [HTTPS & caméra](#https--caméra-kyc).

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

Fichiers de déploiement : `deploy/server/components.env` (**manifeste**, source unique de vérité),
`deploy/server/deploy.sh` (**point d'entrée unique**), `deploy/server/stop.sh`, `Dockerfile`,
`docker-compose.yml` (portail), `deploy/nginx.conf` (gateway), `deploy/federation.manifest.prod.json`.

## Déploiement centralisé — une seule commande

La solution est faite de **4 composants**, chacun dans son dépôt (équipes, stacks et cycles
différents, intégrés par contrat HTTP). Ils ne sont **pas** fusionnés : ils sont **pilotés
depuis union**, qui est le point de centralisation du déploiement.

```bash
bash deploy/server/deploy.sh              # toute la solution (git sync + build + run + santé)
bash deploy/server/deploy.sh promote      # un seul composant
bash deploy/server/deploy.sh --no-sync    # déployer le code local, sans git
bash deploy/server/deploy.sh --check      # ne déploie rien : état + contrôles de santé
bash deploy/server/stop.sh                # arrêt (le Hub, mutualisé, est épargné par défaut)
```

Tout est décrit dans le **manifeste** [`deploy/server/components.env`](deploy/server/components.env) —
dépôt, branche, chemin serveur, port hôte, service compose. **Pour changer un port, une branche
ou ajouter un composant : on édite le manifeste, jamais le script.** Surcharge locale possible
dans `deploy/server/.env` (chargé après, il gagne).

| Composant | Port hôte | Conteneur | Dépôt / branche |
|---|---|---|---|
| **Portail union** (nginx + 3 fronts) — HTTP / **HTTPS** | **6080** / **6443** | `afriland-union` | `union-portal` @ `master` |
| Backend promote (Spring Boot + Postgres + MinIO) | **6390** | `promoteapp-backend-1` | `promoteApp` @ `feat/refonte-ux-parcours` |
| Backend diaspora (FastAPI, OCR CNI) | **6002** | `diaspora-onboarding` | `diaspora-onboarding` @ `develop` |
| Payment Hub (encaissement) | **8090** | `payment-hub-payment-hub-1` | `payment-hub` @ `main` |

**Câblage API** (proxy `deploy/nginx.conf`, origine unique — pas de CORS) :

| Front appelle | Proxifié vers | Backend |
|---|---|---|
| `/promote-api/*` | `host.docker.internal:6390/api/*` | promote (JWT, rôles, ventes, stats) |
| `/api/*` | `host.docker.internal:6002/api/*` | diaspora (onboarding) |

Ce que le script garantit (chaque point = un incident déjà vécu) :

- **fetch avec refspec explicite** (`origin/<branche>` est bien créée, sinon le checkout échoue) ;
- **`--force-recreate` systématique** : sans lui, `up -d --build` construit la nouvelle image mais
  laisse tourner le conteneur sur l'**ancienne** — le déploiement semble réussi et ne l'est pas.
  Le script **vérifie** ensuite que le conteneur tourne bien sur l'image fraîche ;
- **jamais de reset destructif** : `merge --ff-only`, et sync ignorée si le dépôt a des
  modifications locales ou un historique divergent ;
- **override de ports généré** (`<dépôt>/.ports.override.yml`) : les compose de promote/diaspora
  ne publient pas leur backend sur le bon port hôte. Ne jamais lancer `docker compose up` sur
  promote **sans** cet override : le port 6390 disparaît et le portail perd son backend ;
- **contrôles de santé** de bout en bout, y compris à travers le proxy et le provider de paiement
  (`paymenthub` attendu).

> ⚠ **Le Payment Hub est mutualisé** avec d'autres applications de la machine (compte marchand
> global par provider). `deploy.sh` le redéploie, `stop.sh` ne l'arrête **pas** par défaut.

> Le build du front se fait **dans Docker** (multi-stage `Dockerfile`) : le serveur n'a besoin
> que de Docker (pas de Node).

- **CORS** : l'en-tête `Origin` est neutralisé côté proxy (même origine) — sinon Spring
  rejette (« Invalid CORS request »). Idem en dev (`proxy.conf.js`, `removeHeader('origin')`).
- **Connexion staff** : hub → « Espace collaborateur » → login → redirection par rôle
  (`/promote/admin|manager|supervision|dashboard|cashier|print`).
- **Paiement réel** : `APP_PAYMENT_PROVIDER=paymenthub` dans `promoteApp/.env` ;
  voir [Paiement Payment Hub](#paiement-mobile-money-payment-hub).

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

## Paiement mobile money (Payment Hub)

Le backend `promoteApp` ne parle plus directement aux opérateurs : il passe par le **Payment Hub**,
un service d'orchestration séparé (dépôt `payment-hub`) qui porte les identifiants des PSP
— TrustPayWay pour Orange / MTN MoMo, MPGS pour la carte. Le portail ne détient donc **aucun
identifiant opérateur**, seulement une clé API vers le Hub.

L'intégration est **serveur-à-serveur** : le parcours front (souscription & recharge) est inchangé
— le client choisit son opérateur et saisit son numéro dans le portail, le Hub pousse le prompt
USSD, et le front **suit le statut en temps réel** (polling de `…/status`).

```
promoteApp ──POST /api/v1/payments (X-Api-Key)──▶ Payment Hub ──▶ TrustPayWay ──▶ Orange/MTN
           ◀── webhook signé HMAC (X-PayHub-Signature) ──┘
           ──GET /api/v1/payments/{id} (statut, source de vérité)──▶
```

**Sélection de la passerelle** (`app.payment.provider`, lu **au démarrage**) :

| Valeur | Effet |
|---|---|
| `simulated` (défaut) | passerelle factice — le paiement ne se règle que via `PATCH /subscriptions/{ref}/pay` (usage démo/staff). **Le suivi temps réel du front ne peut pas aboutir.** |
| `paymenthub` | vraie passerelle : push USSD réel via le Hub + webhook signé + statut + réconciliation. |

Pour activer le **paiement réel** (backend `promoteApp/.env`, puis **recréer** le conteneur) :

```bash
APP_PAYMENT_PROVIDER=paymenthub
# Identifiants : soit ici en env, soit via l'UI Admin → Paramètres → Payment Hub (stockés en base,
# prioritaires sur l'env, pris en compte à chaud). Les trois sont requis.
PAYHUB_BASE_URL=https://pay.bbcomplex.com
PAYHUB_API_KEY=phk_…             # clé API de l'application, délivrée par le Hub
PAYHUB_WEBHOOK_SECRET=phwh_…     # secret de signature des notifications, délivré par le Hub
```

**Côté Hub** (console d'administration, en-tête `X-Admin-Token`), il faut au préalable :
1. créer l'application Promote → elle renvoie `apiKey` + `webhookSecret` (affichés **une seule fois**) ;
2. renseigner son `webhook_url` : `https://<domaine-public>/api/payment/webhook/payhub` ;
3. activer les moyens `orange` et `mtn` pour cette application ;
4. configurer le provider `trustpayway` du Hub avec les identifiants opérateur (baseUrl, appId, secret).

```bash
docker compose -f promoteApp/docker-compose.yml -f /opt/afriland/.promote-ports.yml \
  up -d --force-recreate backend

# Vérifier la passerelle active :
curl -s http://localhost:6390/api/payment/provider      # -> {"provider":"paymenthub"}
```

Puis **Admin → Paramètres → Payment Hub → Tester la connexion** (interroge le Hub avec la clé API et
vérifie qu'au moins un moyen de paiement est activé pour l'application).
⚠️ Saisir les identifiants dans l'UI **ne suffit pas** à activer le paiement réel : le *provider*
n'est pas en base et ne bascule que par `APP_PAYMENT_PROVIDER` **+ redémarrage**. La réconciliation
automatique (`PAYMENT_RECONCILE=true`) rattrape les paiements dont le webhook n'arrive pas.

> **Webhook** : la notification du Hub est signée en HMAC-SHA256 (`X-PayHub-Signature`) et la
> vérification est **obligatoire** — sans secret configuré l'endpoint répond 503, avec une signature
> invalide 403. C'est ce qui empêche un tiers de marquer une commande « payée ».

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
  [Paiement Payment Hub](#paiement-mobile-money-payment-hub).
- **Paiement toujours « en cours » alors que le client a payé** : le webhook du Hub n'arrive pas
  (URL injoignable depuis le Hub, ou secret désaccordé → 403). Vérifier le `webhook_url` déclaré
  dans le Hub et `PAYHUB_WEBHOOK_SECRET`. La réconciliation finit par rattraper, mais avec délai.

## Notes / TODO

- **Uniformité promote** : la police est alignée (Barlow) et les neutres sont proches
  de la banque ; l'adoption complète des composants `@union/design-system` dans les 17
  pages est progressive. Le rouge Afriland (`#C8102E`) est conservé en couleur de marque.
- **Navigation host-embarquée** : les remotes tournent parfaitement en standalone ; sous
  le host, les routes s'imbriquent (`/promote/…`, `/diaspora/…`). D'éventuels liens
  **absolus** internes de promote (`routerLink="/x"`) restent à passer en relatifs.
- **Polices** : chargées au runtime via `<link>` (inline build-time désactivé).
  Option : self-host Barlow/Inter pour un fonctionnement 100 % hors-ligne.
