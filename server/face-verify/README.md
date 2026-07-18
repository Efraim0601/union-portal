# Face Verify — Microservice de vérification faciale (KYC)

Compare la photo d'une CNI avec un selfie ou une vidéo du client. Basé sur **InsightFace** (détection SCRFD + embeddings ArcFace), l'état de l'art open source pour la vérification 1:1, rapide même sur CPU.

**Aucune donnée n'est stockée** : les images sont traitées en mémoire, les vidéos passent par un fichier temporaire supprimé immédiatement après extraction des frames (bloc `finally`, garanti même en cas d'erreur). Ni fichiers, ni embeddings, ni logs de contenu.

## Démarrage rapide

### Avec Docker (recommandé)

```bash
docker compose up --build
```

Puis ouvrir **http://localhost:8000** — la console de test est incluse.

### Sans Docker

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Au premier démarrage, InsightFace télécharge le pack de modèles `buffalo_l` (~300 Mo) dans `~/.insightface`. Avec Docker, ce téléchargement est fait au build de l'image.

## API

### `POST /api/verify` — CNI vs selfie
Multipart : `id_card` (image), `selfie` (image).

```bash
curl -F "id_card=@cni.jpg" -F "selfie=@selfie.jpg" http://localhost:8000/api/verify
```

```json
{
  "decision": "MATCH",
  "similarity": 0.6123,
  "thresholds": {"match": 0.4, "review": 0.3},
  "id_card": {"det_score": 0.89, "face_size_px": 142, "faces_detected": 1},
  "selfie":  {"det_score": 0.93, "face_size_px": 310, "faces_detected": 1},
  "processing_ms": 210
}
```

### `POST /api/verify-video` — CNI vs vidéo
Multipart : `id_card` (image), `video` (mp4/webm/mov…). La vidéo est échantillonnée (12 frames par défaut réparties sur toute la durée), le score retenu est la **moyenne des 3 meilleures frames** (robuste au flou et aux angles). Un `motion_score` détecte les vidéos trop statiques (photo filmée).

### `GET /health` — sonde de disponibilité

## Décisions

| Décision | Condition | Interprétation |
|---|---|---|
| `MATCH` | similarité ≥ 0.40 | Même personne |
| `REVIEW` | 0.30 ≤ similarité < 0.40 | Zone grise → revue manuelle |
| `NO_MATCH` | similarité < 0.30 | Personnes différentes |

## Réglage des seuils

Tout se configure par variables d'environnement (voir `app/config.py`) : `MATCH_THRESHOLD`, `REVIEW_THRESHOLD`, `MIN_DET_SCORE`, `MIN_FACE_SIZE`, `VIDEO_MAX_FRAMES`, `VIDEO_MAX_MB`, `IMAGE_MAX_MB`.

Recommandation : calibrez sur un échantillon réel de vos CNI. Les photos de CNI sont souvent petites, anciennes et compressées — si vous avez trop de `REVIEW`, descendez `MATCH_THRESHOLD` à 0.35 ; si la sécurité prime, montez à 0.45–0.50.

## Performance

- CPU 4 vCPU : ~150–350 ms par comparaison photo, ~1–3 s par vidéo (12 frames).
- GPU NVIDIA : installez `onnxruntime-gpu` à la place d'`onnxruntime` et mettez `ONNX_PROVIDERS=CUDAExecutionProvider,CPUExecutionProvider`. Comptez ~10× plus rapide.
- Pour monter en charge : plusieurs réplicas derrière un load balancer (le service est sans état, donc scalable horizontalement sans effort).

## Notes de mise en production

- Restreignez `allow_origins` dans `app/main.py` à vos domaines.
- Ajoutez une authentification (clé API ou mTLS) devant le service — il n'en embarque pas.
- Le `motion_score` est une heuristique anti-photo basique, pas une détection de vivacité (liveness) certifiée. Pour un anti-spoofing sérieux (deepfakes, masques, replay), ajoutez un module de liveness dédié (challenge actif : tourner la tête, cligner) ou un fournisseur certifié iBeta/ISO 30107-3.
- Traitement de données biométriques : selon votre juridiction (au Cameroun, la loi n° 2010/012 et le cadre de protection des données), le consentement explicite du client et une déclaration de traitement peuvent être requis, même sans stockage.

## Structure

```
face-verify/
├── app/
│   ├── main.py        # API FastAPI + console web
│   ├── engine.py      # détection + embeddings (InsightFace)
│   ├── video.py       # échantillonnage vidéo en mémoire, zéro stockage
│   ├── config.py      # seuils et limites
│   └── static/index.html  # console de test
├── requirements.txt
├── Dockerfile
└── docker-compose.yml
```
