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

TD1_LEN, TD3_LEN = 30, 44
LEN_TOLERANCE = 3  # marge pour les erreurs de lecture OCR (caractère en trop / manquant)
MIN_FILL_CHARS = 2  # nb minimum de '<' — quasi inexistant dans du texte imprimé normal,
                     # c'est ce qui distingue le plus fiablement une vraie ligne MRZ du reste
                     # du texte de la pièce (nom imprimé, mentions, etc.).

MRZ_CHARSET = re.compile(r"^[A-Z0-9<]+$")


def log(msg: str) -> None:
    print(msg, flush=True)  # flush=True : stdout bufferisé par bloc une fois redirigé/piped


def ocr_lines(image_bytes: bytes) -> list[str]:
    """Lignes de texte OCR triées de haut en bas (position Y de la boîte englobante) —
    indispensable pour la MRZ où chaque ligne a un rôle fixe selon sa position
    (TD1 : 1=doc, 2=biodata, 3=noms ; TD3 : 1=noms, 2=biodata)."""
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    result, _ = _ocr(np.array(img))
    if not result:
        return []
    rows = sorted(result, key=lambda r: sum(p[1] for p in r[0]) / len(r[0]))
    # La MRZ ne contient jamais d'espace, seulement des '<'.
    return [str(r[1]).upper().replace(" ", "") for r in rows]


def _candidates_of_length(lines: list[str], target_len: int) -> list[str]:
    """Lignes dont la longueur est proche de `target_len` ET qui contiennent assez de '<' —
    un texte de recto (nom imprimé, mentions...) n'a normalement jamais de '<' ; exiger les
    deux critères ensemble élimine presque tous les faux positifs qu'un simple gabarit de
    longueur/charset laissait passer (cf. bug où du texte du recto était pris pour la MRZ)."""
    out = []
    for l in lines:
        if not MRZ_CHARSET.match(l):
            continue
        if abs(len(l) - target_len) > LEN_TOLERANCE:
            continue
        if l.count("<") < MIN_FILL_CHARS:
            continue
        out.append(l)
    return out


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
    la position (haut → bas) : 1=document, 2=biodata, 3=noms."""
    out: dict = {}
    if len(lines) < 3:
        return out
    _line1, line2, line3 = lines[-3], lines[-2], lines[-1]

    surname, given = parse_names(line3.ljust(TD1_LEN, "<"))
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
    log(f"[diaspora-ocr] {label}: {len(lines)} ligne(s) OCR brute(s) : {lines}")

    td1_candidates = _candidates_of_length(lines, TD1_LEN)
    td3_candidates = _candidates_of_length(lines, TD3_LEN)
    log(f"[diaspora-ocr] {label}: candidats TD1 (~{TD1_LEN}c, avec '<') : {td1_candidates}")
    log(f"[diaspora-ocr] {label}: candidats TD3 (~{TD3_LEN}c, avec '<') : {td3_candidates}")

    if document_type == "PASSEPORT" and len(td3_candidates) >= 2:
        parsed = parse_td3(td3_candidates[-2:])
    elif len(td1_candidates) >= 3:
        parsed = parse_td1(td1_candidates[-3:])
    elif len(td3_candidates) >= 2:
        parsed = parse_td3(td3_candidates[-2:])
    else:
        parsed = {}
    log(f"[diaspora-ocr] {label}: champs extraits : {parsed}")
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
            log(f"[diaspora-ocr] {label}: échec OCR — {e}")
            parsed = {}
        for k, v in parsed.items():
            fields.setdefault(k, v)
    log(f"[diaspora-ocr] résultat final fusionné : {fields}")
    return fields


@app.get("/health")
def health():
    return {"status": "ok"}
