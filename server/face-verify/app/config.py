"""Configuration du microservice de vérification faciale."""
import os


class Settings:
    # Seuil de similarité cosinus (ArcFace). 0.40 = bon compromis FAR/FRR.
    # Montez vers 0.45-0.50 pour être plus strict (moins de faux positifs).
    MATCH_THRESHOLD: float = float(os.getenv("MATCH_THRESHOLD", "0.40"))

    # Zone grise : entre REVIEW_THRESHOLD et MATCH_THRESHOLD -> revue manuelle
    REVIEW_THRESHOLD: float = float(os.getenv("REVIEW_THRESHOLD", "0.30"))

    # Score minimal de détection de visage (qualité)
    MIN_DET_SCORE: float = float(os.getenv("MIN_DET_SCORE", "0.50"))

    # Taille minimale du visage détecté (pixels) — en dessous, image trop petite/floue
    MIN_FACE_SIZE: int = int(os.getenv("MIN_FACE_SIZE", "60"))

    # Vidéo : nombre max de frames échantillonnées (réparties sur toute la durée)
    VIDEO_MAX_FRAMES: int = int(os.getenv("VIDEO_MAX_FRAMES", "12"))

    # Vidéo : taille max acceptée (Mo) — la vidéo n'est JAMAIS stockée,
    # elle transite par un fichier temporaire supprimé immédiatement.
    VIDEO_MAX_MB: int = int(os.getenv("VIDEO_MAX_MB", "50"))

    # Image : taille max acceptée (Mo)
    IMAGE_MAX_MB: int = int(os.getenv("IMAGE_MAX_MB", "15"))

    # Modèle InsightFace ("buffalo_l" = SCRFD + ArcFace R100, le plus précis)
    MODEL_PACK: str = os.getenv("MODEL_PACK", "buffalo_l")

    # Providers ONNX Runtime. Mettre "CUDAExecutionProvider,CPUExecutionProvider"
    # si GPU disponible (avec onnxruntime-gpu installé).
    ONNX_PROVIDERS: list = os.getenv(
        "ONNX_PROVIDERS", "CPUExecutionProvider"
    ).split(",")

    DET_SIZE: int = int(os.getenv("DET_SIZE", "640"))


settings = Settings()
