# Fiche de test métier — Onboarding KYC diaspora

**Périmètre** : backend `diaspora-otp` (Express + PostgreSQL — migré depuis `node:sqlite`,
cf. Partie E) du parcours d'ouverture de compte à distance pour la diaspora (Afriland First Bank).
**Objectif** : valider le parcours métier **et** la tenue en charge (montée en charge / scaling).
**Environnement de test** : instance isolée, port 10099, Callbell désactivé (repli `fallback_otp`,
zéro WhatsApp réel), base SQLite jetable (`DIASPORA_DATA_DIR`).
**Matériel de référence des mesures** : Intel Core i7‑13620H (16 cœurs logiques), Node 24, Windows 11.

---

## Partie A — Tests fonctionnels (parcours métier)

Convention : ✅ = passant, mesuré lors des tests de charge (0 erreur fonctionnelle constatée).

### CT-01 — Envoi du code OTP (WhatsApp / repli)
| | |
|---|---|
| **Pré-conditions** | `session_id` généré côté client, numéro de téléphone valide |
| **Étapes** | `POST /api/pre-onboarding/otp/send` `{ session_id, phone }` |
| **Résultat attendu** | `200`, `ok:true`. Si Callbell OK → `whatsapp_delivered:true`. Sinon repli : `fallback_otp` (6 chiffres) + `fallback_display:true` + message honnête |
| **Règles métier** | Code à 6 chiffres, TTL 5 min, upsert par `session_id` (un renvoi réinitialise tentatives/vérif) |
| **Statut** | ✅ |

### CT-02 — Vérification du code OTP
| | |
|---|---|
| **Pré-conditions** | CT-01 exécuté, code connu |
| **Étapes** | `POST /api/pre-onboarding/otp/verify` `{ session_id, phone, otp }` |
| **Résultat attendu** | Code exact → `200 verified:true`. Code faux → `400`. Expiré → `400`. > 5 tentatives → `429` |
| **Règles métier** | Max 5 tentatives, expiration à 5 min, incrément de compteur à chaque essai |
| **Statut** | ✅ |

### CT-03 — Upload d'un document (recto/verso, selfie, justificatif)
| | |
|---|---|
| **Pré-conditions** | `session_id` de pré-onboarding valide |
| **Étapes** | `POST /api/pre-onboarding/:sessionId/documents` (multipart `file` + `document_type`) |
| **Résultat attendu** | `200 received:true`, fichier persisté sur disque + ligne en base `documents` |
| **Règles métier** | Taille max 25 Mo (multer). Écriture disque **asynchrone** (ne bloque plus l'event loop) |
| **Statut** | ✅ |

### CT-04 — Création du dossier particulier
| | |
|---|---|
| **Pré-conditions** | OTP vérifié, documents uploadés |
| **Étapes** | `POST /api/applications` (payload KYC + `pre_onboarding_session_id`) |
| **Résultat attendu** | `201`, référence unique `AFR-P-XXXXXX`, statut `EN_COURS_DE_TRAITEMENT`, documents rattachés au dossier |
| **Règles métier** | Référence **garantie unique** : régénération automatique en cas de collision (cf. CT-11) |
| **Statut** | ✅ |

### CT-05 — Suivi de statut du dossier
| | |
|---|---|
| **Étapes** | `GET /api/applications/status-by-email?email=…` / `…/status-by-contact` / `…/status/:reference` |
| **Résultat attendu** | `200` avec `{ reference, status, message }` si trouvé, `404` sinon |
| **Statut** | ✅ |

### CT-06 — Référentiels (pays, nationalités, agences, listes KYC)
| | |
|---|---|
| **Étapes** | `GET /api/countries/active`, `/nationalities/active`, `/agencies/active`, `/lookups/:kind`, `/lookups/packages` |
| **Résultat attendu** | `200` + liste non vide (amorcée au 1er démarrage) |
| **Statut** | ✅ (mesuré à ~930 req/s sous charge, 0 erreur) |

### CT-07 — Dossier entreprise
| | |
|---|---|
| **Étapes** | `POST /api/enterprise-applications` |
| **Résultat attendu** | `201`, référence unique `AFR-ENT-XXXXXX` |
| **Statut** | ✅ (même correctif d'unicité que CT-04) |

### CT-08 — Admin : session + paramétrage des listes
| | |
|---|---|
| **Étapes** | `POST /api/admin/login` puis `PUT /api/lookups/:kind`, `/agencies/active`, `/lookups/packages` (Bearer requis) |
| **Résultat attendu** | Login KO → `401` ; écriture sans `Authorization` → `401` ; sinon liste remplacée |
| **Statut** | ✅ (⚠️ auth de dev, à durcir avant prod — cf. commentaires code) |

---

## Partie B — Tests de charge / montée en charge (scaling)

### Protocole
- Modèle *closed-loop* : N VUs rejouent le scénario en boucle ; rampe **10 → 50 → 150 → 300 VUs**.
- Métriques : débit (req/s), latence p50/p95/p99/max, taux d'erreur, en direct puis en synthèse.
- **Test décisif** : comparer le plafond **lecture pure** et le plafond **écriture** pour isoler
  le goulot (CPU ? disque ? base ?).

### CT-09 — Baseline (mono-process, AVANT correctifs)
| Métrique | Valeur |
|---|---|
| Débit plafond | **~158 req/s** (identique de 10 à 300 VUs → goulot sérialisé) |
| Latence p99 (300 VUs) | **~12 500 ms** |
| Erreurs | 4 × `HTTP 500` = `UNIQUE constraint failed: applications.reference` |
| **Verdict** | ❌ Ne scale pas : un seul cœur utilisé, event loop bloqué par I/O synchrone |

### CT-10 — Après correctifs (16 workers)
| Scénario (rampe → 300-500 VUs) | Débit plafond | p99 | Erreurs |
|---|---|---|---|
| Lecture pure (référentiels) | **~926 req/s** | ~1,6 s | 0 |
| OTP seul (écritures DB pures) | ~275 req/s | ~4,8 s | 0 |
| Parcours complet (DB + upload fichier) | ~167 req/s | ~4,8 s | **0** |
| Parcours complet — **baseline pour comparaison** | ~158 req/s | ~6,5 s | 4 |

**Lecture des résultats**
- La **lecture scale ×5-6** avec les 16 workers → le clustering fonctionne.
- L'**écriture reste bornée** (~170-275 req/s) quel que soit le nombre de workers.
- ✅ Plus **aucune** erreur 500 (retry sur collision de référence).

> ⚠️ **Erratum (établi en Partie E)** : l'attribution initiale de ce plafond d'écriture au
> mono-écrivain SQLite était **incomplète**. La migration PostgreSQL (écrivains concurrents)
> a donné exactement le même plafond — la cause dominante est un **plafond environnemental
> par requête de la machine de dev Windows** (cf. E.3), pas la base de données.

### CT-11 — Non-régression : collision de référence sous charge
| | |
|---|---|
| **Scénario** | ≥ 2 000 créations de dossiers concurrentes |
| **Avant** | 4 × `HTTP 500` (référence 6 chiffres aléatoires, sans retry) |
| **Après** | 0 erreur — régénération automatique de la référence sur violation `UNIQUE` |
| **Statut** | ✅ |

---

## Partie C — Correctifs appliqués

| # | Correctif | Fichier | Effet mesuré |
|---|---|---|---|
| 1 | **Clustering** (1 worker/cœur) | `server.js` (nouveau) | Lecture ×5-6 (160 → 930 req/s) |
| 2 | **Écriture fichier asynchrone** (`fs.promises.writeFile`) | `index.js` | p99 upload 2 290 → 1 900 ms |
| 3 | **`busy_timeout` + `synchronous=NORMAL`** | `db.js` | Écritures multi-process sans `SQLITE_BUSY`, moins de fsync |
| 4 | **Retry sur collision de référence** | `db.js` | 4 erreurs 500 → 0 |
| 5 | **`DIASPORA_DATA_DIR` surchargeable** | `db.js` | Tests isolés sans polluer les données de dev |
| 6 | **`NODE_CLUSTER_SCHED_POLICY=rr`** (Windows) | `server.js` | Répartition 92 %/1 worker → uniforme sur 16 |
| 7 | **Migration SQLite → PostgreSQL** | `db.js`, `index.js` | Partie E |

---

## Partie E — Migration PostgreSQL (réalisée) et ce qu'elle a révélé

### E.1 Ce qui a été migré
La base passe de SQLite (`node:sqlite`, synchrone, mono-écrivain) à **PostgreSQL** (`pg`,
asynchrone, pool de connexions par worker, écrivains réellement concurrents) :

| Élément | Avant (SQLite) | Après (PostgreSQL) |
|---|---|---|
| Driver | `DatabaseSync` — **bloque l'event loop** | `pg` async — l'event loop reste libre |
| Écritures | 1 écrivain à la fois (WAL) | Concurrentes (MVCC) |
| Transactions dossier | implicites | `BEGIN/COMMIT` explicites (insert + rattachement docs atomiques) |
| Payload dossiers | TEXT (JSON stringifié) | **JSONB** (requêtable/indexable) |
| Bootstrap schéma+seeds | au chargement du module | `pg_advisory_lock` — un seul worker sème, sans course |
| Config | fichier local | `DATABASE_URL` (+ `PG_POOL_MAX`/worker) |
| Erreurs async | — | wrapper `ah()` + middleware d'erreur (500 JSON, pas de crash worker) |
| Unicité référence | retry sur `UNIQUE constraint failed` | retry sur code PG `23505` |

Infrastructure : service `postgres:17-alpine` (healthcheck + volume) dans
`deploy/test/docker-compose.yml` ; pour le dev sans Docker, `node loadtest/pg-dev.mjs` lance un
PostgreSQL embarqué et affiche le `DATABASE_URL`.

### E.2 Validation fonctionnelle sur PostgreSQL
Parcours complet rejoué sur Postgres embarqué : référentiels seedés, OTP send/verify (bon code,
mauvais code 400, expiration), save-file CNI_RECTO, CLIENT_VIDEO avec repli face-verify
(`MODELS_MISSING` non bloquant), route documents legacy, création dossier + rattachement
transactionnel des documents, statuts par référence/email/contact, 404, entreprise. **Tout passe.**
Sous charge soutenue (300 à 1000 VUs) : **0 erreur**.

### E.3 Découverte majeure : le plafond mesuré était environnemental
Postgres n'a **pas** déplacé le plafond de ~160 parcours/s. L'investigation systématique a montré :

| Expérience | Résultat | Conclusion |
|---|---|---|
| Postgres vs SQLite (même rampe) | ~156 vs ~167 req/s | la base n'est pas le goulot |
| 2 clients de charge en parallèle | 84 + 90 = 174 req/s | le client de test n'est pas le goulot |
| `synchronous_commit=off` | ~168 req/s | pas fsync-bound |
| Répartition cluster (header `X-Worker`) | **92 % sur 1 worker** | bug réel → corrigé (`SCH_RR`) |
| Après fix RR (répartition 16/16 uniforme) | ~147 req/s | la répartition n'était pas le goulot non plus |
| POST à vide (sans DB ni disque) | **~465 req/s** | plafond POST de la machine |
| GET à vide | ~926 req/s | plafond GET de la machine |
| CPU pendant la charge | node 4 %/1600, Defender 0 % | **machine idle : tout le monde attend** |
| 1000 VUs | ~159 req/s, latence ×2 | plafond dur par requête, pas une file |

**Conclusion** : cette machine de dev (Windows 11 Enterprise, poste managé — filtrage réseau /
EDR d'entreprise) impose un **coût fixe par requête POST sur le loopback** qui borne tout test
d'écriture à ~150-460 req/s quelle que soit l'architecture logicielle. **Les chiffres absolus de
cette fiche minorent la capacité réelle** ; la mesure de capacité qui fait foi doit être rejouée
sur la stack Linux (`deploy/test/docker-compose.yml`, qui inclut désormais Postgres) avec le même
harnais.

Ce que la migration apporte malgré tout, **prouvé ici** : zéro erreur de contention en écriture
concurrente, intégrité transactionnelle du dossier, event loop libéré (le driver synchrone gelait
les lectures pendant chaque écriture), et la levée du mur architectural mono-écrivain pour la prod.

---

## Partie F — Recommandations pour la vraie montée en charge

1. ~~Migrer SQLite → PostgreSQL~~ — **fait** (Partie E).
2. **Rejouer la mesure de capacité sur la stack Linux** (docker compose) avec ce même harnais —
   les plafonds mesurés ici sont ceux du poste de dev, pas de l'application.
3. **Sortir les uploads du chemin critique et du disque local** — stockage objet (S3/MinIO) ou
   volume dédié. Retire le coût disque + scan antivirus des requêtes.
4. **Garder le clustering avec `NODE_CLUSTER_SCHED_POLICY=rr`** (défaut ailleurs que Windows ;
   sur Windows sans lui, 92 % du trafic va sur un seul worker).
5. **Réduire le nombre d'écritures par parcours** — ex. `otp/verify` fait 2 `UPDATE` séparés
   (incrément tentatives + marquage vérifié) fusionnables en un seul.
6. **Reverse proxy** (nginx déjà présent dans `deploy/`) en frontal, puis scale **horizontal**
   (plusieurs nœuds Node sur le même Postgres — désormais possible grâce à la migration).

> Sur ce poste de dev : ~**900 req/s en lecture**, ~**150-170 soumissions de parcours/s**,
> 0 erreur jusqu'à 1000 VUs. Ces chiffres sont un **plancher** imposé par l'environnement du
> poste ; la capacité réelle sur serveur Linux sera mesurée au point 2.
