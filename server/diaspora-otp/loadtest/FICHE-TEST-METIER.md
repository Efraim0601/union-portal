# Fiche de test métier — Onboarding KYC diaspora

**Périmètre** : backend `diaspora-otp` (Express + `node:sqlite`) du parcours d'ouverture de
compte à distance pour la diaspora (Afriland First Bank).
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
- L'**écriture reste bornée** (~170-275 req/s) quel que soit le nombre de workers → goulot =
  **sérialisation des écritures SQLite** (un seul écrivain à la fois, partagé par tous les process).
- L'**upload de document** abaisse encore le débit (167 vs 275) : coût de l'écriture disque
  (150 Ko/fichier, potentiellement scannés par l'antivirus) sur le chemin de la requête.
- ✅ Plus **aucune** erreur 500 (retry sur collision de référence).

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

---

## Partie D — Recommandations pour la vraie montée en charge

Le mur de débit du **parcours d'onboarding est l'écriture SQLite** (mono-écrivain *by design*).
Le clustering ne le franchit pas. Par ordre de rapport gain/effort :

1. **Garder le clustering** — en prod le trafic diaspora est majoritairement en **lecture**
   (référentiels, suivi de statut, navigation) ; le clustering y apporte un gain massif.
2. **Sortir les uploads du chemin critique et du disque local** — stockage objet (S3/MinIO) ou
   au minimum un volume dédié exclu de l'analyse antivirus. Retire le coût disque des requêtes.
3. **Réduire le nombre d'écritures par parcours** — ex. `otp/verify` fait 2 `UPDATE` séparés
   (incrément tentatives + marquage vérifié) fusionnables en un seul.
4. **`DatabaseSync` bloque l'event loop** : même clusterisée, une écriture contendue gèle les
   lectures en file sur le même worker. Pour découpler, viser un driver DB **asynchrone**.
5. **Pour un vrai volume d'écriture diaspora : migrer SQLite → PostgreSQL** (écrivains
   concurrents + pool de connexions). SQLite est idéal pour ce pilote/dev, single-writer en prod.
6. **Reverse proxy** (nginx déjà présent dans `deploy/`) en frontal : keep-alive, limitation de
   débit, TLS ; puis scale **horizontal** (plusieurs nœuds) une fois la base en Postgres.

> Capacité actuelle estimée (16 cœurs, 1 nœud) : ~**900 req/s en lecture**, ~**170 soumissions de
> parcours/s en écriture**, sans erreur. Suffisant pour un pilote ; planifier les points 2 et 5
> avant une ouverture grand public simultanée.
