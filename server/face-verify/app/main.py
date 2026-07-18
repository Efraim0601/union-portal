"""
Microservice de vérification faciale (KYC).

Endpoints :
  GET  /health                    -> état du service et du modèle
  POST /api/verify                -> CNI (image) vs selfie (image)
  POST /api/verify-video          -> CNI (image) vs vidéo du client
  GET  /                          -> console de test web

Aucune donnée n'est stockée : images et vidéos sont traitées en mémoire
et les fichiers temporaires vidéo sont supprimés immédiatement.
"""
from __future__ import annotations

import os
import time

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import settings
from .engine import FaceError, cosine_similarity, decision, decode_image, extract_face, get_engine
from .video import analyze_video

app = FastAPI(
    title="Face Verify",
    version="1.0.0",
    description="Vérification faciale 1:1 (CNI vs selfie/vidéo) — sans stockage.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # à restreindre en production
    allow_methods=["*"],
    allow_headers=["*"],
)

STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


def _err(e: FaceError, status: int = 422):
    raise HTTPException(status_code=status, detail={"code": e.code, "message": e.message})


async def _read_upload(file: UploadFile, max_mb: int, kind: str) -> bytes:
    data = await file.read()
    if len(data) > max_mb * 1024 * 1024:
        raise HTTPException(413, detail={"code": "too_large", "message": f"{kind} dépasse {max_mb} Mo."})
    if not data:
        raise HTTPException(422, detail={"code": "empty_file", "message": f"{kind} vide."})
    return data


@app.on_event("startup")
def warmup():
    # Charge le modèle au démarrage pour éviter la latence sur la 1re requête
    get_engine()


@app.get("/health")
def health():
    return {
        "status": "ok",
        "model": settings.MODEL_PACK,
        "match_threshold": settings.MATCH_THRESHOLD,
        "review_threshold": settings.REVIEW_THRESHOLD,
        "storage": "none",
    }


@app.post("/api/verify")
async def verify(
    id_card: UploadFile = File(..., description="Photo de la CNI"),
    selfie: UploadFile = File(..., description="Photo du client"),
):
    t0 = time.perf_counter()
    id_bytes = await _read_upload(id_card, settings.IMAGE_MAX_MB, "La photo de CNI")
    selfie_bytes = await _read_upload(selfie, settings.IMAGE_MAX_MB, "Le selfie")

    try:
        id_face = extract_face(decode_image(id_bytes), context="la CNI")
        selfie_face = extract_face(decode_image(selfie_bytes), context="le selfie")
    except FaceError as e:
        _err(e)

    sim = cosine_similarity(id_face.embedding, selfie_face.embedding)
    return {
        "decision": decision(sim),
        "similarity": round(sim, 4),
        "thresholds": {"match": settings.MATCH_THRESHOLD, "review": settings.REVIEW_THRESHOLD},
        "id_card": {
            "det_score": round(id_face.det_score, 3),
            "face_size_px": id_face.face_size,
            "faces_detected": id_face.n_faces,
        },
        "selfie": {
            "det_score": round(selfie_face.det_score, 3),
            "face_size_px": selfie_face.face_size,
            "faces_detected": selfie_face.n_faces,
        },
        "processing_ms": int((time.perf_counter() - t0) * 1000),
    }


@app.post("/api/verify-video")
async def verify_video(
    id_card: UploadFile = File(..., description="Photo de la CNI"),
    video: UploadFile = File(..., description="Vidéo du client (non stockée)"),
):
    t0 = time.perf_counter()
    id_bytes = await _read_upload(id_card, settings.IMAGE_MAX_MB, "La photo de CNI")
    video_bytes = await _read_upload(video, settings.VIDEO_MAX_MB, "La vidéo")

    suffix = os.path.splitext(video.filename or "")[1] or ".mp4"

    try:
        id_face = extract_face(decode_image(id_bytes), context="la CNI")
        analysis = analyze_video(video_bytes, id_face.embedding, suffix=suffix)
    except FaceError as e:
        _err(e)
    finally:
        del video_bytes  # libère la mémoire au plus tôt

    sim = analysis.mean_top3  # moyenne des 3 meilleures frames = robuste
    return {
        "decision": decision(sim),
        "similarity": round(sim, 4),
        "best_frame_similarity": round(analysis.best_similarity, 4),
        "thresholds": {"match": settings.MATCH_THRESHOLD, "review": settings.REVIEW_THRESHOLD},
        "video": {
            "frames_analyzed": analysis.frames_analyzed,
            "frames_with_face": analysis.frames_with_face,
            "motion_score": analysis.motion_score,
            "motion_hint": "ok" if analysis.motion_score > 0.005 else "très statique — vérifier qu'il ne s'agit pas d'une photo filmée",
            "stored": False,
        },
        "processing_ms": int((time.perf_counter() - t0) * 1000),
    }


@app.get("/")
def index():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))
