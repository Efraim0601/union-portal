"""
Service OCR local pour le parcours diaspora : lit la MRZ (bande lisible en machine,
norme ICAO 9303) au dos d'une CNI (TD1, 3 lignes) ou en bas de la page photo d'un
passeport (TD3, 2 lignes) pour préremplir nom/prénom/date de naissance/nationalité.
Prototype dev — dans le vrai backend (diaspora-onboarding, FastAPI, dépôt séparé),
cette logique devrait être portée telle quelle ou remplacée par un moteur KYC dédié.
"""
import io
import re
from datetime import date, datetime
from typing import Optional

import numpy as np
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from rapidocr_onnxruntime import RapidOCR

app = FastAPI(title="diaspora-ocr")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

_ocr = RapidOCR()

MRZ_LINE = re.compile(r"^[A-Z0-9<]{28,44}$")


def ocr_lines(image_bytes: bytes) -> list[str]:
    """Lignes de texte OCR triées de haut en bas (position Y de la boîte englobante) —
    indispensable pour la MRZ où chaque ligne a un rôle fixe selon sa position
    (TD1 : 1=doc, 2=biodata, 3=noms ; TD3 : 1=noms, 2=biodata), pas selon son contenu
    seul (plusieurs lignes peuvent contenir '<<' à cause du remplissage)."""
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    result, _ = _ocr(np.array(img))
    if not result:
        return []
    # RapidOCR renvoie [[box, texte, confiance], ...], box = 4 points [x,y].
    rows = sorted(result, key=lambda r: sum(p[1] for p in r[0]) / len(r[0]))
    # La MRZ ne contient jamais d'espace, seulement des '<'.
    return [str(r[1]).upper().replace(" ", "") for r in rows]


def find_mrz_candidates(lines: list[str]) -> list[str]:
    return [l for l in lines if MRZ_LINE.match(l)]


def mrz_date(raw: str, *, is_expiry: bool = False) -> Optional[str]:
    """AAMMJJ (année sur 2 chiffres) -> ISO 8601. Heuristique de siècle standard MRZ."""
    if len(raw) != 6 or not raw.isdigit():
        return None
    yy, mm, dd = int(raw[0:2]), int(raw[2:4]), int(raw[4:6])
    if not (1 <= mm <= 12) or not (1 <= dd <= 31):
        return None
    current_yy = datetime.now().year % 100
    century = 2000 if (is_expiry or yy <= current_yy) else 1900
    try:
        return date(century + yy, mm, dd).isoformat()
    except ValueError:
        return None


def parse_names(field: str) -> tuple[str, str]:
    """'SURNAME<<GIVEN<NAMES<<<<' -> ('SURNAME', 'GIVEN NAMES'), casse titre."""
    field = field.rstrip("<")
    parts = field.split("<<", 1)
    surname = parts[0].replace("<", " ").strip()
    given = parts[1].replace("<", " ").strip() if len(parts) > 1 else ""
    return surname.title(), given.title()


def parse_td1(lines: list[str]) -> dict:
    """CNI / carte de séjour / carte consulaire — 3 lignes de 30 caractères, rôle fixé par
    la position (haut → bas) : 1=document, 2=biodata, 3=noms. `lines` doit déjà être trié
    de haut en bas (cf. ocr_lines) — on ne se fie plus au contenu seul ('<<' peut apparaître
    en fin de ligne 1 ou 2 à cause du remplissage)."""
    out: dict = {}
    if len(lines) < 3:
        return out
    _line1, line2, line3 = lines[-3], lines[-2], lines[-1]

    surname, given = parse_names(line3.ljust(30, "<"))
    if surname:
        out["last_name"] = surname
    if given:
        out["first_name"] = given

    if len(line2) >= 14:
        bdate = mrz_date(line2[0:6])
        if bdate:
            out["birth_date"] = bdate
        if len(line2) >= 18:
            nat = line2[15:18].replace("<", "")
            if nat.isalpha():
                out["nationality"] = nat

    return out


def parse_td3(lines: list[str]) -> dict:
    """Passeport — 2 lignes de 44 caractères : 1=noms, 2=biodata (haut → bas)."""
    out: dict = {}
    if len(lines) < 2:
        return out
    line1, line2 = lines[-2], lines[-1]

    rest = line1[5:] if line1.startswith("P") and len(line1) > 5 else line1
    surname, given = parse_names(rest)
    if surname:
        out["last_name"] = surname
    if given:
        out["first_name"] = given

    if len(line2) >= 28:
        doc_num = line2[0:9].replace("<", "")
        if doc_num:
            out["identity_document_number"] = doc_num
        nat = line2[10:13].replace("<", "")
        if nat.isalpha():
            out["nationality"] = nat
        bdate = mrz_date(line2[13:19])
        if bdate:
            out["birth_date"] = bdate

    return out


def extract_from_image(content: bytes, document_type: str, *, label: str) -> dict:
    lines = ocr_lines(content)
    candidates = find_mrz_candidates(lines)
    print(f"[diaspora-ocr] {label}: {len(lines)} lignes OCR, {len(candidates)} candidate(s) MRZ")
    print(f"[diaspora-ocr] {label} lignes brutes: {lines}")
    print(f"[diaspora-ocr] {label} candidats MRZ: {candidates}")

    if document_type == "PASSEPORT" and len(candidates) >= 2:
        parsed = parse_td3(candidates[-2:])
    elif len(candidates) >= 3:
        parsed = parse_td1(candidates[-3:])
    elif len(candidates) == 2:
        parsed = parse_td3(candidates)
    else:
        parsed = {}
    print(f"[diaspora-ocr] {label} champs extraits: {parsed}")
    return parsed


@app.post("/extract")
async def extract(
    recto: UploadFile = File(...),
    verso: Optional[UploadFile] = File(None),
    document_type: str = Form("CNI"),
):
    fields: dict = {}
    # Verso d'abord : c'est là que vit la MRZ pour une carte (CNI/séjour/consulaire).
    for side, label in filter(lambda t: t[0], [(verso, "verso"), (recto, "recto")]):
        content = await side.read()
        try:
            parsed = extract_from_image(content, document_type, label=label)
        except Exception as e:
            print(f"[diaspora-ocr] {label}: échec OCR — {e}")
            parsed = {}
        for k, v in parsed.items():
            fields.setdefault(k, v)
    print(f"[diaspora-ocr] résultat final fusionné: {fields}")
    return fields


@app.get("/health")
def health():
    return {"status": "ok"}
