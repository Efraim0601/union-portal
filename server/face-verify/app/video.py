"""
Analyse vidéo SANS stockage.

La vidéo reçue est écrite dans un fichier temporaire (obligatoire pour le
décodeur OpenCV), échantillonnée en frames en mémoire, puis le fichier est
supprimé dans le bloc `finally` — quoi qu'il arrive. Rien n'est conservé :
ni la vidéo, ni les frames, ni les embeddings.
"""
from __future__ import annotations

import os
import tempfile
from dataclasses import dataclass

import cv2
import numpy as np

from .config import settings
from .engine import FaceError, cosine_similarity, extract_face


@dataclass
class VideoAnalysis:
    best_similarity: float
    mean_top3: float
    frames_analyzed: int
    frames_with_face: int
    motion_score: float        # variation de position/taille du visage (anti-photo)
    embedding_spread: float    # cohérence des embeddings entre frames


def _sample_frames(path: str, max_frames: int) -> list[np.ndarray]:
    cap = cv2.VideoCapture(path)
    try:
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        if total <= 0:
            # Certains conteneurs (webm) ne donnent pas le total : lecture séquentielle
            frames = []
            step_keep = 5
            i = 0
            while len(frames) < max_frames:
                ok, frame = cap.read()
                if not ok:
                    break
                if i % step_keep == 0:
                    frames.append(frame)
                i += 1
            return frames

        indices = np.linspace(0, max(total - 1, 0), num=min(max_frames, total), dtype=int)
        frames = []
        for idx in indices:
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(idx))
            ok, frame = cap.read()
            if ok and frame is not None:
                frames.append(frame)
        return frames
    finally:
        cap.release()


def analyze_video(video_bytes: bytes, reference_embedding: np.ndarray, suffix: str = ".mp4") -> VideoAnalysis:
    tmp_path = None
    try:
        # Fichier temporaire éphémère — jamais dans un répertoire de données
        fd, tmp_path = tempfile.mkstemp(suffix=suffix)
        with os.fdopen(fd, "wb") as f:
            f.write(video_bytes)

        frames = _sample_frames(tmp_path, settings.VIDEO_MAX_FRAMES)
        if not frames:
            raise FaceError("invalid_video", "Vidéo illisible ou vide.")

        sims, centers, sizes, embs = [], [], [], []
        for frame in frames:
            try:
                fr = extract_face(frame, context="la vidéo")
            except FaceError:
                continue
            sims.append(cosine_similarity(reference_embedding, fr.embedding))
            x1, y1, x2, y2 = fr.bbox
            h, w = frame.shape[:2]
            centers.append(((x1 + x2) / 2 / w, (y1 + y2) / 2 / h))
            sizes.append((x2 - x1) / w)
            embs.append(fr.embedding)

        if not sims:
            raise FaceError("no_face", "Aucun visage détecté dans la vidéo.")

        sims_arr = np.array(sims)
        top3 = np.sort(sims_arr)[-3:]

        # Anti-spoof heuristique : une vraie personne bouge un minimum
        centers_arr = np.array(centers)
        motion = float(np.std(centers_arr, axis=0).mean() + np.std(sizes))

        embs_arr = np.stack(embs)
        spread = float(1.0 - np.mean(embs_arr @ embs_arr.mean(axis=0) /
                                     max(np.linalg.norm(embs_arr.mean(axis=0)), 1e-6)))

        return VideoAnalysis(
            best_similarity=float(sims_arr.max()),
            mean_top3=float(top3.mean()),
            frames_analyzed=len(frames),
            frames_with_face=len(sims),
            motion_score=round(motion, 4),
            embedding_spread=round(spread, 4),
        )
    finally:
        # Suppression garantie : la vidéo ne survit jamais à la requête
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass
