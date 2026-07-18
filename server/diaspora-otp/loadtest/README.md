# Test de charge — backend `diaspora-otp`

Harnais de montée en charge sans dépendance (`loadtest.mjs`) : Node pur (`http` keep-alive +
`perf_hooks`), modèle *closed-loop* avec rampe d'utilisateurs virtuels (VUs) et métriques
temps réel (débit, latence p50/p95/p99, taux d'erreur).

## Lancer une instance de test isolée (mode repli sûr)

⚠️ **Toujours** vider les identifiants Callbell pour ne pas envoyer de vrais WhatsApp en masse,
et pointer une base **jetable** pour ne pas polluer les données de dev.

```bash
cd server/diaspora-otp

# 1) PostgreSQL embarqué (terminal 1) — affiche le DATABASE_URL à utiliser
node loadtest/pg-dev.mjs

# 2) instance de test (terminal 2) : Callbell désactivé (fallback_otp), 16 workers
DATABASE_URL="postgres://diaspora:diaspora@localhost:15432/diaspora" \
DIASPORA_DATA_DIR="$TEMP/diaspora-loadtest-data" \
PORT=10099 CALLBELL_API_KEY="" CALLBELL_CHANNEL_UUID="" CLUSTER_WORKERS=16 PG_POOL_MAX=5 \
node server.js
```

- `CALLBELL_API_KEY=""` → `/otp/send` renvoie `fallback_otp`, **zéro** appel WhatsApp réel.
- `DATABASE_URL` → base Postgres cible (embarquée ici ; service `postgres` du compose sinon).
- `PG_POOL_MAX` → connexions **par worker** (16×5=80, sous le `max_connections=100` par défaut).
- `DIASPORA_DATA_DIR` → répertoire des uploads, jetable (défaut : `./data`).
- `CLUSTER_WORKERS` → nombre de process (défaut = nombre de cœurs ; `1` = mono-process).

## Lancer la charge

```bash
cd server/diaspora-otp/loadtest

# parcours KYC complet, rampe 10→50→150→300 VUs
BASE_URL=http://localhost:10099 SCENARIO=journey RAMP="10:10,50:12,150:12,300:15" DOC_KB=150 \
node loadtest.mjs
```

### Variables

| Variable   | Défaut                          | Rôle |
|------------|---------------------------------|------|
| `BASE_URL` | `http://localhost:10099`        | Cible |
| `SCENARIO` | `journey`                       | `journey` \| `otp` \| `read` \| `mixed` |
| `RAMP`     | `10:12,50:12,150:12,300:15`     | Paliers `VUs:secondes` séparés par des virgules |
| `DOC_KB`   | `150`                           | Taille du document uploadé (Ko) |

### Scénarios

| Nom       | Ce qu'il exerce | Chemin |
|-----------|-----------------|--------|
| `journey` | `otp/send` → `otp/verify` → `documents` → `applications` | **écriture** (parcours complet) |
| `otp`     | `otp/send` + `otp/verify` | écriture DB pure |
| `read`    | référentiels (countries/nationalities/agencies/lookups) | **lecture** |
| `mixed`   | 80% lecture / 20% parcours | trafic réaliste |

## Interpréter

- **Débit qui plafonne quand les VUs montent** = goulot sérialisé (le système ne va pas plus
  vite, la charge s'accumule en file → la latence explose).
- Comparer `read` / `otp` / `journey` isole la couche en cause (réseau, DB, disque).
- ⚠️ **Sur un poste Windows managé**, l'environnement (filtrage réseau/EDR) impose un coût fixe
  par requête qui écrase les différences applicatives — cf. Partie E de la fiche. Les mesures
  qui font foi se font sur la stack Linux (`deploy/test/docker-compose.yml`).
- Le header `X-Worker` (PID) permet de vérifier la répartition entre workers du cluster.

Voir [`FICHE-TEST-METIER.md`](./FICHE-TEST-METIER.md) pour le protocole complet, les résultats
mesurés, la migration PostgreSQL et les recommandations de scaling.
