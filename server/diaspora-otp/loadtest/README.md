# Test de charge — backend `diaspora-otp`

Harnais de montée en charge sans dépendance (`loadtest.mjs`) : Node pur (`http` keep-alive +
`perf_hooks`), modèle *closed-loop* avec rampe d'utilisateurs virtuels (VUs) et métriques
temps réel (débit, latence p50/p95/p99, taux d'erreur).

## Lancer une instance de test isolée (mode repli sûr)

⚠️ **Toujours** vider les identifiants Callbell pour ne pas envoyer de vrais WhatsApp en masse,
et pointer une base de données jetable (`DIASPORA_DATA_DIR`) pour ne pas polluer les données de dev.

```bash
cd server/diaspora-otp

# instance de test : port 10099, Callbell désactivé (fallback_otp), base jetable, 16 workers
DIASPORA_DATA_DIR="$TEMP/diaspora-loadtest-data" \
PORT=10099 CALLBELL_API_KEY="" CALLBELL_CHANNEL_UUID="" CLUSTER_WORKERS=16 \
node server.js
```

- `CALLBELL_API_KEY=""` → `/otp/send` renvoie `fallback_otp`, **zéro** appel WhatsApp réel.
- `DIASPORA_DATA_DIR` → base + uploads dans un dossier jetable (défaut : `./data`).
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
- Comparer `read` (plafond lecture) et `journey`/`otp` (plafond écriture) **isole** la cause :
  ici la lecture monte à ~930 req/s, l'écriture bute à ~170-275 req/s → **c'est l'écriture
  SQLite (un seul écrivain) qui borne**, pas le CPU.

Voir [`FICHE-TEST-METIER.md`](./FICHE-TEST-METIER.md) pour le protocole complet, les résultats
mesurés et les recommandations de scaling.
