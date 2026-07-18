"""
Moteur de reconnaissance faciale.

Basé sur InsightFace (détection SCRFD + embeddings ArcFace), l'état de l'art
open source pour la vérification 1:1. Tout est traité en mémoire (numpy),
aucune image ni embedding n'est persisté par ce module.
"""
from __future__ import annotations

import threading
from dataclasses import dataclass

import cv2
import numpy as np

from .config import settings

_app = None
_lock = threading.Lock()


def get_engine():
    """Charge le modèle une seule fois (thread-safe, lazy)."""
    global _app
    if _app is None:
        with _lock:
            if _app is None:
                from insightface.app import FaceAnalysis

                app = FaceAnalysis(
                    name=settings.MODEL_PACK,
                    providers=settings.ONNX_PROVIDERS,
                    allowed_modules=["detection", "recognition"],
                )
                app.prepare(ctx_id=0, det_size=(settings.DET_SIZE, settings.DET_SIZE))
                _app = app
    return _app


@dataclass
class FaceResult:
    embedding: np.ndarray          # embedding L2-normalisé (512-d)
    bbox: tuple                    # (x1, y1, x2, y2)
    det_score: float               # confiance de détection
    face_size: int                 # min(largeur, hauteur) du visage en px
    n_faces: int                   # nombre de visages détectés dans l'image


class FaceError(Exception):
    def __init__(self, code: str, message: str):
        self.code = code
        self.message = message
        super().__init__(message)


def decode_image(data: bytes) -> np.ndarray:
    arr = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise FaceError("invalid_image", "Fichier image illisible ou format non supporté.")
    # Redimensionne les images géantes pour la vitesse (sans perte utile)
    h, w = img.shape[:2]
    if max(h, w) > 2000:
        scale = 2000 / max(h, w)
        img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    return img


def extract_face(img: np.ndarray, *, context: str = "image") -> FaceResult:
    """
    Détecte le visage principal et calcule son embedding.
    Lève FaceError si aucun visage exploitable.
    """
    engine = get_engine()
    faces = engine.get(img)

    if not faces:
        raise FaceError("no_face", f"Aucun visage détecté dans {context}.")

    # Visage principal = plus grand * meilleur score
    def key(f):
        x1, y1, x2, y2 = f.bbox
        return (x2 - x1) * (y2 - y1) * float(f.det_score)

    face = max(faces, key=key)
    x1, y1, x2, y2 = [int(v) for v in face.bbox]
    size = min(x2 - x1, y2 - y1)

    if float(face.det_score) < settings.MIN_DET_SCORE:
        raise FaceError("low_quality", f"Visage trop peu net dans {context} (score {face.det_score:.2f}).")
    if size < settings.MIN_FACE_SIZE:
        raise FaceError("face_too_small", f"Visage trop petit dans {context} ({size}px). Rapprochez la caméra ou fournissez une image plus grande.")

    emb = face.normed_embedding.astype(np.float32)
    return FaceResult(
        embedding=emb,
        bbox=(x1, y1, x2, y2),
        det_score=float(face.det_score),
        face_size=size,
        n_faces=len(faces),
    )


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(a, b))  # embeddings déjà L2-normalisés


def decision(similarity: float) -> str:
    if similarity >= settings.MATCH_THRESHOLD:
        return "MATCH"
    if similarity >= settings.REVIEW_THRESHOLD:
        return "REVIEW"
    return "NO_MATCH"
